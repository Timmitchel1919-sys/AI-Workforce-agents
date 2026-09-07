/**
 * Research Agent — the first reusable General Agent.
 *
 * Deterministic, non-recursive pipeline:
 *
 *   validate task
 *     → load project/task context (this project only)
 *     → plan sub-questions + search queries        (model call)
 *     → for each query: search → for each hit: fetch + evaluate source
 *     → synthesize findings                        (model call)
 *     → deterministic post-processing (drop bogus citations, downgrade
 *       unsupported facts, compute confidence)
 *     → build + validate ResearchResult
 *
 * It goes through `ModelProvider` and `ToolProvider` only — it never imports a
 * vendor SDK. Every tool call is permission-checked. Hard limits
 * (iterations / tool calls / model calls / wall-clock) are enforced by the
 * `GeneralAgent` base. Failures are structured `AgentExecutionError`s.
 */
import {
  type Agent,
  type AgentLimits,
  type Environment,
  type ModelMessage,
  type ModelProvider,
  type PermissionAction,
  type PermissionGuard,
  type PermissionRequest,
  type ResearchConfidence,
  type ResearchEvidence,
  type ResearchFinding,
  type ResearchResult,
  type ResearchSource,
  type ResearchTask,
  type SourceType,
  type Task,
  type TaskContext,
  type ToolProvider,
  AgentExecutionError,
  DEFAULT_AGENT_LIMITS,
  ProviderUnavailableError,
  validateResearchResult,
  validateResearchTask,
} from "../../contracts/index.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { AgentRun, GeneralAgent } from "../../core/agents/general-agent.js";
import { ContextSystem } from "../../core/context/context-system.js";
import { PermissionSystem } from "../../core/permissions/permission-system.js";
import {
  RESEARCH_AGENT_ID,
  RESEARCH_AGENT_LIMITS,
  RESEARCH_TOOL_FETCH,
  RESEARCH_TOOL_SEARCH,
} from "./research-agent-definition.js";

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

export interface ResearchAgentConfig {
  /** Provider-neutral model. When absent, the agent fails `model_unavailable`. */
  model?: ModelProvider;
  tools: ToolProvider;
  permissions: PermissionSystem;
  context: ContextSystem;
  audit: AuditLog;
  environment?: Environment;
  limits?: Partial<AgentLimits>;
  clock?: () => number;
  /** Attach truncated prompt/source previews to audit data. Default `false`. */
  logContent?: boolean;
  /** Max sources fetched + read per run. Default 5. */
  maxSources?: number;
}

/* ------------------------------------------------------------------ */
/* Internal shapes                                                    */
/* ------------------------------------------------------------------ */

interface ResearchPlan {
  subQuestions: string[];
  searchQueries: string[];
}

interface SearchHit {
  title: string;
  reference: string;
  snippet: string;
  sourceType?: SourceType;
  relevance?: number;
}

interface FetchedSource {
  reference: string;
  title: string;
  sourceType?: SourceType;
  content: string;
  reputation?: number;
  verified: boolean;
}

interface RawFinding {
  statement: string;
  kind: ResearchFinding["kind"];
  supportingSourceIds: string[];
}

interface Synthesis {
  executiveSummary: string;
  findings: RawFinding[];
  assumptions: string[];
  limitations: string[];
  recommendations: string[];
}

/* ------------------------------------------------------------------ */
/* Agent                                                              */
/* ------------------------------------------------------------------ */

const BASE_RELIABILITY: Record<SourceType, number> = {
  dataset: 0.8,
  api: 0.7,
  document: 0.7,
  internal_note: 0.6,
  web_page: 0.5,
  unknown: 0.3,
};

export class ResearchAgent extends GeneralAgent<ResearchTask, ResearchResult> {
  protected readonly agentId = RESEARCH_AGENT_ID;
  protected readonly role = "researcher";
  protected readonly limits: AgentLimits;

  private readonly model: ModelProvider | undefined;
  private readonly tools: ToolProvider;
  private readonly permissions: PermissionSystem;
  private readonly context: ContextSystem;
  private readonly environment: Environment;
  private readonly logContent: boolean;
  private readonly maxSources: number;

  constructor(config: ResearchAgentConfig) {
    super({ audit: config.audit, clock: config.clock });
    this.limits = {
      ...DEFAULT_AGENT_LIMITS,
      ...RESEARCH_AGENT_LIMITS,
      ...(config.limits ?? {}),
    };
    this.model = config.model;
    this.tools = config.tools;
    this.permissions = config.permissions;
    this.context = config.context;
    this.environment = config.environment ?? "local";
    this.logContent = config.logContent ?? false;
    this.maxSources = config.maxSources ?? 5;
  }

  protected validateInput(raw: unknown): ResearchTask {
    try {
      return validateResearchTask(raw);
    } catch (error) {
      throw this.fail(
        "invalid_task",
        error instanceof Error ? error.message : String(error),
        {},
        error,
      );
    }
  }

  protected validateOutput(output: unknown): asserts output is ResearchResult {
    try {
      validateResearchResult(output);
    } catch (error) {
      throw this.fail(
        "invalid_result",
        error instanceof Error ? error.message : String(error),
        {},
        error,
      );
    }
  }

  protected async run(
    input: ResearchTask,
    task: Task,
    _agent: Agent,
    run: AgentRun,
    _guard: PermissionGuard | undefined,
  ): Promise<ResearchResult> {
    run.checkDeadline();

    // 1. LOAD PROJECT / TASK CONTEXT — this project only.
    const projectCtx =
      this.context.getProjectContext(task.projectId)?.values ?? {};
    const taskCtx =
      this.context.getTaskContext(task.id, task.projectId)?.values ?? {};
    run.activity("context_loaded", {
      projectId: task.projectId,
      projectKeys: Object.keys(projectCtx),
      taskKeys: Object.keys(taskCtx),
    });

    // 2. PLAN.
    run.nextIteration("plan");
    run.checkDeadline();
    const plan = await this.plan(input, projectCtx, task, run);
    run.activity("plan_ready", {
      subQuestions: plan.subQuestions,
      queryCount: plan.searchQueries.length,
    });

    // 3-5. COLLECT + EVALUATE.
    const sources: ResearchSource[] = [];
    const evidence: ResearchEvidence[] = [];
    const notes: string[] = [];

    for (const query of plan.searchQueries) {
      run.checkDeadline();
      if (sources.length >= this.maxSources) break;

      this.assertTool(task, run, "execute", RESEARCH_TOOL_SEARCH);
      run.activity("tool_requested", { tool: RESEARCH_TOOL_SEARCH, query });
      run.countToolCall(RESEARCH_TOOL_SEARCH);
      const hits = await this.search(task, query);
      run.activity("tool_result", {
        tool: RESEARCH_TOOL_SEARCH,
        hitCount: hits.length,
      });

      for (const [rank, hit] of hits.entries()) {
        run.checkDeadline();
        if (sources.length >= this.maxSources) break;

        this.assertTool(task, run, "read", RESEARCH_TOOL_FETCH);
        run.activity("tool_requested", {
          tool: RESEARCH_TOOL_FETCH,
          reference: hit.reference,
        });
        run.countToolCall(RESEARCH_TOOL_FETCH);
        const fetched = await this.fetch(task, hit.reference);

        const id = `src_${sources.length + 1}`;
        const source = this.buildSource(id, hit, fetched, rank, hits.length);
        sources.push(source);
        if (source.verified && fetched.content) {
          evidence.push({
            sourceId: id,
            excerpt: truncate(fetched.content, 280),
          });
        } else {
          notes.push(
            `source ${id} (${hit.reference || "no reference"}) could not be verified`,
          );
        }
        run.activity("source_collected", {
          sourceId: id,
          sourceType: source.sourceType,
          reliability: source.reliability,
          verified: source.verified,
        });
      }
    }

    // 6. SYNTHESIZE.
    run.nextIteration("synthesize");
    run.checkDeadline();
    const synth = await this.synthesize(
      input,
      plan,
      sources,
      evidence,
      task,
      run,
    );
    run.activity("synthesis", { findingCount: synth.findings.length });

    // 7. DETERMINISTIC POST-PROCESSING.
    const knownIds = new Set(sources.map((s) => s.id));
    const droppedCitations: string[] = [];
    const findings: ResearchFinding[] = synth.findings.map((raw) => {
      const supporting = raw.supportingSourceIds.filter((sid) => {
        if (knownIds.has(sid)) return true;
        droppedCitations.push(sid);
        return false;
      });
      let kind = raw.kind;
      if (
        (kind === "fact" || kind === "claim") &&
        !supporting.some((sid) => sources.find((s) => s.id === sid)?.verified)
      ) {
        kind = "assumption";
        notes.push(
          `downgraded "${truncate(raw.statement, 60)}" to assumption: no verified source`,
        );
      }
      return {
        statement: raw.statement,
        kind,
        supportingSourceIds: supporting,
      };
    });

    const verifiedCount = sources.filter((s) => s.verified).length;
    const limitations = dedupe([
      ...synth.limitations,
      ...notes,
      ...(droppedCitations.length
        ? [
            `ignored ${droppedCitations.length} model-cited source id(s) not in the collected set`,
          ]
        : []),
      ...(verifiedCount < input.sourcesRequired
        ? [
            `collected ${verifiedCount} verified source(s); ${input.sourcesRequired} requested`,
          ]
        : []),
    ]);

    const confidence = computeConfidence({
      sources,
      findings,
      plannedQuestions: plan.subQuestions,
      targetSources: input.sourcesRequired,
    });
    run.activity("confidence_scored", {
      level: confidence.level,
      score: confidence.score,
    });

    return {
      taskId: task.id,
      agentId: this.agentId,
      question: input.question,
      executiveSummary: synth.executiveSummary,
      findings,
      evidence,
      sources,
      assumptions: dedupe(synth.assumptions),
      limitations,
      confidence,
      recommendations: dedupe(synth.recommendations),
      createdAt: new Date(this.now()).toISOString(),
      metadata: {
        outputFormat: input.outputFormat,
        counters: run.counters,
        projectId: task.projectId,
        contextKeys: {
          project: Object.keys(projectCtx),
          task: Object.keys(taskCtx),
        },
      },
    };
  }

  /* -------------------------------------------------------------- */
  /* steps                                                          */
  /* -------------------------------------------------------------- */

  private async plan(
    input: ResearchTask,
    projectCtx: Record<string, unknown>,
    task: Task,
    run: AgentRun,
  ): Promise<ResearchPlan> {
    const system =
      "You are the planning step of a research agent. Break the question into " +
      "2-5 focused sub-questions and 2-5 web search queries. Respond with ONLY " +
      'a JSON object: {"subQuestions": string[], "searchQueries": string[]}.';
    const user = [
      `Objective: ${input.objective}`,
      `Question: ${input.question}`,
      input.scope ? `Scope: ${input.scope}` : "",
      input.constraints.length
        ? `Constraints: ${input.constraints.join("; ")}`
        : "",
      Object.keys(projectCtx).length
        ? `Project context keys: ${Object.keys(projectCtx).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const raw = await this.callModel(task, run, "plan", [
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      throw this.fail(
        "model_failure",
        "planning model returned no parseable JSON",
      );
    }
    const subQuestions = toStringArray(parsed.subQuestions).slice(0, 5);
    const searchQueries = toStringArray(parsed.searchQueries).slice(0, 5);
    return {
      subQuestions: subQuestions.length ? subQuestions : [input.question],
      searchQueries: searchQueries.length ? searchQueries : [input.question],
    };
  }

  private async synthesize(
    input: ResearchTask,
    plan: ResearchPlan,
    sources: readonly ResearchSource[],
    evidence: readonly ResearchEvidence[],
    task: Task,
    run: AgentRun,
  ): Promise<Synthesis> {
    const sourceList =
      sources
        .map(
          (s) =>
            `- ${s.id}: ${s.title} (${s.reference || "no reference"}) ` +
            `[${s.verified ? "verified" : "UNVERIFIED"}]`,
        )
        .join("\n") || "(no sources collected)";
    const excerptList =
      evidence.map((e) => `- ${e.sourceId}: ${e.excerpt}`).join("\n") ||
      "(no excerpts)";

    const system =
      "You are the synthesis step of a research agent. Use ONLY the provided " +
      "sources and cite them by id. Classify every finding as one of: fact, " +
      "claim, assumption, inference, recommendation. A fact or claim MUST cite " +
      "at least one verified source id. Do NOT invent sources or ids. Do NOT " +
      'assign confidence. Respond with ONLY JSON: {"executiveSummary": string, ' +
      '"findings": [{"statement": string, "kind": string, "sourceIds": ' +
      'string[]}], "assumptions": string[], "limitations": string[], ' +
      '"recommendations": string[]}.';
    const user = [
      `Question: ${input.question}`,
      `Objective: ${input.objective}`,
      `Sub-questions:\n${plan.subQuestions.map((q) => `- ${q}`).join("\n")}`,
      `Sources:\n${sourceList}`,
      `Excerpts:\n${excerptList}`,
    ].join("\n\n");

    const raw = await this.callModel(task, run, "synthesize", [
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      throw this.fail(
        "model_failure",
        "synthesis model returned no parseable JSON",
      );
    }

    const findings: RawFinding[] = Array.isArray(parsed.findings)
      ? parsed.findings
          .filter(
            (f): f is Record<string, unknown> =>
              !!f && typeof f === "object" && !Array.isArray(f),
          )
          .map((f) => ({
            statement: typeof f.statement === "string" ? f.statement : "",
            kind: normalizeKind(f.kind),
            supportingSourceIds: toStringArray(
              f.sourceIds ?? f.supportingSourceIds,
            ),
          }))
          .filter((f) => f.statement !== "")
      : [];

    return {
      executiveSummary:
        typeof parsed.executiveSummary === "string"
          ? parsed.executiveSummary
          : "",
      findings,
      assumptions: toStringArray(parsed.assumptions),
      limitations: toStringArray(parsed.limitations),
      recommendations: toStringArray(parsed.recommendations),
    };
  }

  /* -------------------------------------------------------------- */
  /* model + tools                                                  */
  /* -------------------------------------------------------------- */

  private async callModel(
    task: Task,
    run: AgentRun,
    label: string,
    messages: ModelMessage[],
  ): Promise<string> {
    run.checkDeadline();
    run.countModelCall(label);
    if (!this.model) {
      throw this.fail("model_unavailable", "no model provider configured", {
        label,
      });
    }
    run.activity("model_call", {
      label,
      messageCount: messages.length,
      ...(this.logContent
        ? {
            promptPreview: truncate(
              messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
              300,
            ),
          }
        : {}),
    });
    try {
      const response = await this.model.generate({
        messages,
        metadata: {
          taskId: task.id,
          agentId: this.agentId,
          projectId: task.projectId,
        },
      });
      run.activity("model_result", {
        label,
        model: response.model,
        chars: response.content.length,
      });
      return response.content;
    } catch (error) {
      const reason =
        error instanceof ProviderUnavailableError
          ? "model_unavailable"
          : "model_failure";
      throw this.fail(
        reason,
        `model call "${label}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { label },
        error,
      );
    }
  }

  private assertTool(
    task: Task,
    run: AgentRun,
    action: PermissionAction,
    tool: string,
  ): void {
    const request: PermissionRequest = {
      action,
      toolId: tool,
      agentId: this.agentId,
      projectId: task.projectId,
      environment: this.environment,
    };
    const decision = this.permissions.evaluate(request);
    run.activity("tool_decision", {
      tool,
      action,
      allowed: decision.allowed,
      reason: decision.reason,
    });
    if (!decision.allowed) {
      throw this.fail(
        "permission_denied",
        `denied ${action} on ${tool}: ${decision.reason}`,
        { tool, action },
      );
    }
  }

  private async invokeTool(
    task: Task,
    tool: string,
    input: unknown,
  ): Promise<unknown> {
    if (!this.tools.tools.includes(tool)) {
      throw this.fail("tool_unavailable", `tool "${tool}" is not provided`, {
        tool,
      });
    }
    const context: TaskContext = {
      scope: "task",
      taskId: task.id,
      projectId: task.projectId,
      values: {},
    };
    try {
      const response = await this.tools.execute({ tool, input, context });
      return response.output;
    } catch (error) {
      throw this.fail(
        "tool_failure",
        `tool "${tool}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { tool },
        error,
      );
    }
  }

  private async search(task: Task, query: string): Promise<SearchHit[]> {
    const output = await this.invokeTool(task, RESEARCH_TOOL_SEARCH, { query });
    return normalizeSearchHits(output);
  }

  /**
   * A single failed fetch is recoverable — it yields an unverified source that
   * is marked and down-weighted, not a hard failure. A missing fetch *tool*
   * still fails hard.
   */
  private async fetch(task: Task, reference: string): Promise<FetchedSource> {
    try {
      const output = await this.invokeTool(task, RESEARCH_TOOL_FETCH, {
        reference,
      });
      return normalizeFetched(reference, output);
    } catch (error) {
      if (
        error instanceof AgentExecutionError &&
        error.reason === "tool_unavailable"
      ) {
        throw error;
      }
      return {
        reference,
        title: reference,
        sourceType: "unknown",
        content: "",
        verified: false,
      };
    }
  }

  private buildSource(
    id: string,
    hit: SearchHit,
    fetched: FetchedSource,
    rank: number,
    total: number,
  ): ResearchSource {
    const sourceType: SourceType =
      fetched.sourceType ?? hit.sourceType ?? inferSourceType(hit.reference);
    const base = BASE_RELIABILITY[sourceType];
    let reliability = fetched.verified ? base : Math.min(base, 0.25);
    if (
      typeof fetched.reputation === "number" &&
      fetched.reputation >= 0 &&
      fetched.reputation <= 1
    ) {
      reliability = clamp01(0.5 * reliability + 0.5 * fetched.reputation);
    }
    const relevance = clamp01(
      total > 1 ? 1 - rank / total : (hit.relevance ?? 0.6),
    );
    return {
      id,
      title: fetched.title || hit.title || hit.reference || "untitled source",
      reference: hit.reference ?? "",
      sourceType,
      retrievedAt: new Date(this.now()).toISOString(),
      relevance: round2(relevance),
      reliability: round2(reliability),
      reliabilityBasis: fetched.verified
        ? `retrieved ${sourceType}; base ${base}` +
          (fetched.reputation !== undefined
            ? `; reputation ${fetched.reputation}`
            : "")
        : `unverified ${sourceType} (fetch failed or empty); capped at 0.25`,
      verified: fetched.verified,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Confidence model                                                   */
/* ------------------------------------------------------------------ */

/**
 * Deterministic confidence, derived from **evidence quality and completeness**,
 * never from model wording. Composite of four bounded components:
 *
 *   0.35 * sourceCoverage   verified sources / requested sources   (capped 1)
 *   0.30 * avgReliability    mean reliability of verified sources
 *   0.20 * supportRatio      findings with >=1 supporting source / all findings
 *   0.15 * questionCoverage  supported findings / planned sub-questions (capped 1)
 *
 *   score >= 0.70 → high, >= 0.40 → medium, else low
 *
 * Hard rules: zero verified sources → low; a "high" score with fewer than
 * min(requested, 2) verified sources → medium.
 */
export function computeConfidence(params: {
  sources: readonly ResearchSource[];
  findings: readonly ResearchFinding[];
  plannedQuestions: readonly string[];
  targetSources: number;
}): ResearchConfidence {
  const verified = params.sources.filter((s) => s.verified);
  const target = Math.max(params.targetSources, 1);
  const sourceCoverage = clamp01(verified.length / target);
  const avgReliability = verified.length
    ? verified.reduce((sum, s) => sum + s.reliability, 0) / verified.length
    : 0;
  const supported = params.findings.filter(
    (f) => f.supportingSourceIds.length > 0,
  );
  const supportRatio = params.findings.length
    ? supported.length / params.findings.length
    : 0;
  const questionCoverage = params.plannedQuestions.length
    ? clamp01(supported.length / params.plannedQuestions.length)
    : 0;

  const score = round2(
    0.35 * sourceCoverage +
      0.3 * avgReliability +
      0.2 * supportRatio +
      0.15 * questionCoverage,
  );

  let level: ResearchConfidence["level"] =
    score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low";
  if (verified.length === 0) {
    level = "low";
  } else if (level === "high" && verified.length < Math.min(target, 2)) {
    level = "medium";
  }

  return {
    level,
    score,
    basis:
      `score ${score} = 0.35*coverage(${round2(sourceCoverage)}) + ` +
      `0.30*reliability(${round2(avgReliability)}) + ` +
      `0.20*support(${round2(supportRatio)}) + ` +
      `0.15*questions(${round2(questionCoverage)}); ` +
      `verified sources ${verified.length}/${target}`,
  };
}

/* ------------------------------------------------------------------ */
/* pure helpers                                                       */
/* ------------------------------------------------------------------ */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === "string" && v.trim()))];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
}

const SOURCE_TYPES: readonly SourceType[] = [
  "web_page",
  "document",
  "dataset",
  "api",
  "internal_note",
  "unknown",
];

function isSourceType(value: unknown): value is SourceType {
  return (
    typeof value === "string" && SOURCE_TYPES.includes(value as SourceType)
  );
}

function inferSourceType(reference: string): SourceType {
  const ref = reference.toLowerCase();
  if (ref.startsWith("note:")) return "internal_note";
  if (/\.(csv|tsv|json|parquet)(\?|$)/.test(ref)) return "dataset";
  if (/\.(pdf|md|txt|docx?)(\?|$)/.test(ref)) return "document";
  if (ref.startsWith("http://") || ref.startsWith("https://"))
    return "web_page";
  return "unknown";
}

function normalizeKind(value: unknown): ResearchFinding["kind"] {
  const kind = typeof value === "string" ? value.toLowerCase() : "";
  return kind === "fact" ||
    kind === "claim" ||
    kind === "assumption" ||
    kind === "inference" ||
    kind === "recommendation"
    ? kind
    : "inference";
}

function normalizeSearchHits(output: unknown): SearchHit[] {
  const rows = Array.isArray(output)
    ? output
    : output &&
        typeof output === "object" &&
        Array.isArray((output as { results?: unknown }).results)
      ? (output as { results: unknown[] }).results
      : [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      title: typeof r.title === "string" ? r.title : "",
      reference:
        typeof r.reference === "string"
          ? r.reference
          : typeof r.url === "string"
            ? r.url
            : "",
      snippet: typeof r.snippet === "string" ? r.snippet : "",
      sourceType: isSourceType(r.sourceType) ? r.sourceType : undefined,
      relevance: typeof r.relevance === "number" ? r.relevance : undefined,
    }))
    .filter((hit) => hit.reference !== "");
}

function normalizeFetched(reference: string, output: unknown): FetchedSource {
  const record =
    output && typeof output === "object"
      ? (output as Record<string, unknown>)
      : {};
  const content =
    typeof record.content === "string"
      ? record.content
      : typeof record.text === "string"
        ? record.text
        : "";
  return {
    reference,
    title: typeof record.title === "string" ? record.title : "",
    sourceType: isSourceType(record.sourceType) ? record.sourceType : undefined,
    content,
    reputation:
      typeof record.reputation === "number" ? record.reputation : undefined,
    verified: content.trim().length > 0,
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const parse = (candidate: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(candidate);
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = parse(text.trim());
  if (direct) return direct;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? parse(text.slice(start, end + 1)) : null;
}
