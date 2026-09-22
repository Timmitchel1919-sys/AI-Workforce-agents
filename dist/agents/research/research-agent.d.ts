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
import { type Agent, type AgentLimits, type Environment, type ModelProvider, type PermissionGuard, type ResearchConfidence, type ResearchFinding, type ResearchResult, type ResearchSource, type ResearchTask, type Task } from "../../contracts/index.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { AgentRun, GeneralAgent } from "../../core/agents/general-agent.js";
import { ContextSystem } from "../../core/context/context-system.js";
import { ToolExecutionEngine } from "../../core/tools/tool-execution-engine.js";
export interface ResearchAgentConfig {
    /** Provider-neutral model. When absent, the agent fails `model_unavailable`. */
    model?: ModelProvider;
    /**
     * The one secure path to tools. The agent creates a `ToolExecutionRequest`
     * and hands it to the engine — it never invokes a tool, a `ToolProvider`, or
     * the permission system directly. Permissions, approval, and per-task/agent
     * limits are enforced inside the engine.
     */
    toolEngine: ToolExecutionEngine;
    context: ContextSystem;
    audit: AuditLog;
    environment?: Environment;
    limits?: Partial<AgentLimits>;
    clock?: () => number;
    /** Attach truncated prompt/source previews to audit data. Default `false`. */
    logContent?: boolean;
    /** Max sources fetched + read per run. Default 5. */
    maxSources?: number;
    /** Override the tool ids (defaults: research.search / research.fetch). */
    searchToolId?: string;
    fetchToolId?: string;
}
export declare class ResearchAgent extends GeneralAgent<ResearchTask, ResearchResult> {
    protected readonly agentId = "research-agent";
    protected readonly role = "researcher";
    protected readonly limits: AgentLimits;
    private readonly model;
    private readonly toolEngine;
    private readonly context;
    private readonly environment;
    private readonly logContent;
    private readonly maxSources;
    private readonly searchToolId;
    private readonly fetchToolId;
    constructor(config: ResearchAgentConfig);
    protected validateInput(raw: unknown): ResearchTask;
    protected validateOutput(output: unknown): asserts output is ResearchResult;
    protected run(input: ResearchTask, task: Task, _agent: Agent, run: AgentRun, _guard: PermissionGuard | undefined): Promise<ResearchResult>;
    private plan;
    private synthesize;
    private callModel;
    /**
     * The only path to a tool. Builds a `ToolExecutionRequest`, hands it to the
     * `ToolExecutionEngine` (which enforces permissions, approval, eligibility,
     * and per-task/agent limits), and maps the `ToolExecutionResult` back onto a
     * structured `AgentExecutionError` on anything other than success.
     */
    private callTool;
    private search;
    /**
     * A single failed fetch is recoverable — it yields an unverified source that
     * is marked and down-weighted. A missing tool or a permission denial still
     * fails the run hard.
     */
    private fetch;
    private buildSource;
}
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
export declare function computeConfidence(params: {
    sources: readonly ResearchSource[];
    findings: readonly ResearchFinding[];
    plannedQuestions: readonly string[];
    targetSources: number;
}): ResearchConfidence;
