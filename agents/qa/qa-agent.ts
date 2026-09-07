/**
 * QA Agent.
 *
 * One model call evaluates each acceptance criterion against the supplied
 * artifacts and returns findings + defects + a verdict. Deterministic
 * post-processing then enforces "QA must not automatically approve its own
 * work": any acceptance criterion the model didn't address becomes an
 * unsatisfied finding, and a `"pass"` verdict is downgraded to `"fail"`
 * whenever any finding is unsatisfied — on top of `validateQAResult`'s own
 * structural rejection of an unevidenced pass.
 */
import {
  type Agent,
  type AgentLimits,
  type DefectSeverity,
  type Environment,
  type ModelProvider,
  type PermissionGuard,
  type QADefect,
  type QAFinding,
  type QAResult,
  type QATask,
  type QAVerdict,
  type Task,
  DEFAULT_AGENT_LIMITS,
  ProviderUnavailableError,
  validateQAResult,
  validateQATask,
} from "../../contracts/index.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { AgentRun, GeneralAgent } from "../../core/agents/general-agent.js";
import { extractJsonObject, truncate } from "../shared/text-utils.js";
import { QA_AGENT_ID, QA_AGENT_LIMITS } from "./qa-agent-definition.js";

export interface QaAgentConfig {
  model?: ModelProvider;
  audit: AuditLog;
  limits?: Partial<AgentLimits>;
  clock?: () => number;
  environment?: Environment;
  logContent?: boolean;
}

const VERDICTS: readonly QAVerdict[] = ["pass", "fail", "blocked"];
const SEVERITIES: readonly DefectSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

export class QaAgent extends GeneralAgent<QATask, QAResult> {
  protected readonly agentId = QA_AGENT_ID;
  protected readonly role = "qa";
  protected readonly limits: AgentLimits;

  private readonly model: ModelProvider | undefined;
  private readonly logContent: boolean;

  constructor(config: QaAgentConfig) {
    super({ audit: config.audit, clock: config.clock });
    this.limits = {
      ...DEFAULT_AGENT_LIMITS,
      ...QA_AGENT_LIMITS,
      ...(config.limits ?? {}),
    };
    this.model = config.model;
    this.logContent = config.logContent ?? false;
  }

  protected validateInput(raw: unknown): QATask {
    try {
      return validateQATask(raw);
    } catch (error) {
      throw this.fail(
        "invalid_task",
        error instanceof Error ? error.message : String(error),
        {},
        error,
      );
    }
  }

  protected validateOutput(output: unknown): asserts output is QAResult {
    try {
      validateQAResult(output);
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
    input: QATask,
    task: Task,
    _agent: Agent,
    run: AgentRun,
    _guard: PermissionGuard | undefined,
  ): Promise<QAResult> {
    run.checkDeadline();
    run.nextIteration("evaluate");

    const raw = await this.callModel(task, run, input);
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      throw this.fail("model_failure", "qa model returned no parseable JSON");
    }

    const findings = reconcileFindings(
      input.acceptanceCriteria,
      parsed.findings,
    );
    const defects = normalizeDefects(parsed.defects);
    const verdict = enforceVerdict(normalizeVerdict(parsed.verdict), findings);
    run.activity("evaluation_ready", {
      verdict,
      findingCount: findings.length,
      defectCount: defects.length,
    });

    return {
      taskId: task.id,
      agentId: this.agentId,
      verdict,
      findings,
      defects,
      recommendation:
        typeof parsed.recommendation === "string" &&
        parsed.recommendation.trim()
          ? parsed.recommendation
          : verdict === "pass"
            ? "No further action required."
            : "Address the unsatisfied criteria before re-evaluation.",
      createdAt: new Date(this.now()).toISOString(),
      metadata: { objective: input.objective },
    };
  }

  private async callModel(
    task: Task,
    run: AgentRun,
    input: QATask,
  ): Promise<string> {
    run.checkDeadline();
    run.countModelCall("evaluate");
    if (!this.model) {
      throw this.fail("model_unavailable", "no model provider configured");
    }

    const system =
      "You are the QA Agent. Evaluate EVERY acceptance criterion against the " +
      "given artifacts. For each criterion produce a finding with satisfied " +
      "(true/false) and evidence. List defects for anything unsatisfied. Only " +
      'use verdict "pass" when every criterion is satisfied. Respond with ' +
      'ONLY JSON: {"verdict": "pass"|"fail"|"blocked", "findings": ' +
      '[{"criterion": string, "satisfied": boolean, "evidence": string}], ' +
      '"defects": [{"id": string, "severity": "low"|"medium"|"high"|"critical", ' +
      '"description": string, "remediation": string}], "recommendation": string}.';
    const user = [
      `Objective: ${input.objective}`,
      `Acceptance criteria:\n${input.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`,
      input.artifacts.length
        ? `Artifacts:\n${input.artifacts
            .map(
              (a) =>
                `- ${a.id}: ${a.description}${a.content ? `\n  ${truncate(a.content, 400)}` : ""}`,
            )
            .join("\n")}`
        : "Artifacts: (none provided)",
      input.constraints.length
        ? `Constraints: ${input.constraints.join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    run.activity("model_call", {
      ...(this.logContent
        ? { promptPreview: truncate(`${system}\n${user}`, 300) }
        : {}),
    });
    try {
      const response = await this.model.generate({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        metadata: {
          taskId: task.id,
          agentId: this.agentId,
          projectId: task.projectId,
        },
      });
      run.activity("model_result", {
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
        `model call failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error,
      );
    }
  }
}

function normalizeVerdict(value: unknown): QAVerdict {
  return typeof value === "string" && VERDICTS.includes(value as QAVerdict)
    ? (value as QAVerdict)
    : "fail";
}

/**
 * Ensure every acceptance criterion has a finding. Any criterion the model
 * didn't address becomes an unsatisfied finding rather than being silently
 * dropped — the source of the "no automatic self-approval" guarantee.
 */
function reconcileFindings(
  acceptanceCriteria: readonly string[],
  raw: unknown,
): QAFinding[] {
  const modelFindings = Array.isArray(raw)
    ? raw
        .filter(
          (f): f is Record<string, unknown> =>
            !!f && typeof f === "object" && !Array.isArray(f),
        )
        .map((f): QAFinding => ({
          criterion: typeof f.criterion === "string" ? f.criterion : "",
          satisfied: f.satisfied === true,
          evidence:
            typeof f.evidence === "string" && f.evidence.trim()
              ? f.evidence
              : "no evidence provided",
        }))
        .filter((f) => f.criterion !== "")
    : [];

  const byCriterion = new Map(modelFindings.map((f) => [f.criterion, f]));
  return acceptanceCriteria.map(
    (criterion) =>
      byCriterion.get(criterion) ?? {
        criterion,
        satisfied: false,
        evidence: "model produced no finding for this criterion",
      },
  );
}

function enforceVerdict(
  verdict: QAVerdict,
  findings: readonly QAFinding[],
): QAVerdict {
  if (verdict === "pass" && !findings.every((f) => f.satisfied)) {
    return "fail";
  }
  return verdict;
}

function normalizeDefects(value: unknown): QADefect[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (d): d is Record<string, unknown> =>
        !!d && typeof d === "object" && !Array.isArray(d),
    )
    .map((d, index) => ({
      id:
        typeof d.id === "string" && d.id.trim() ? d.id : `defect_${index + 1}`,
      severity: SEVERITIES.includes(d.severity as DefectSeverity)
        ? (d.severity as DefectSeverity)
        : "medium",
      description: typeof d.description === "string" ? d.description : "",
      remediation: typeof d.remediation === "string" ? d.remediation : "",
    }))
    .filter((d) => d.description !== "" && d.remediation !== "");
}
