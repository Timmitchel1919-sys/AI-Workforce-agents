/** Bounded, read-only production executor for Control Plane analysis tasks. */
import { type Agent, type AgentLimits, type PermissionGuard, type StructuredModelProvider, type Task } from "../../contracts/index.js";
import { AuditLog, AgentRun, GeneralAgent, type ModelRouter, type UsageLedger } from "../../core/index.js";
export declare const CONTROL_PLANE_ANALYSIS_AGENT_ID = "control-plane-analysis-agent";
export declare const CONTROL_PLANE_ANALYSIS_TASK_TYPE = "control-plane-analysis";
export declare const CONTROL_PLANE_ANALYSIS_LIMITS: AgentLimits;
export interface ControlPlaneAnalysisInput {
    objective: string;
    context?: readonly string[];
    constraints?: readonly string[];
}
export interface ControlPlaneAnalysisResult {
    taskId: string;
    agentId: string;
    summary: string;
    findings: readonly string[];
    risks: readonly string[];
    recommendations: readonly string[];
    confidence: "low" | "medium" | "high";
    createdAt: string;
    metadata: {
        provider: string;
        /** The ACTUAL model the provider reported for this response. */
        model: string;
        /**
         * What the Model Router selected (undefined when it selected no SPECIFIC
         * model — a profile with no pinned model accepts whatever the provider
         * serves). Preserved alongside `model` — REQUESTED MODEL != ACTUAL MODEL
         * — never overwritten by the provider's report.
         */
        requestedModel?: string;
        routingDecisionId?: string;
        usage?: {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
        };
        counters: {
            toolCalls: number;
            modelCalls: number;
            iterations: number;
        };
    };
}
export interface OpenAIAgentExecutorOptions {
    provider: StructuredModelProvider;
    audit: AuditLog;
    limits?: Partial<AgentLimits>;
    clock?: () => number;
    /**
     * EO-7: when supplied, every call first asks the Model Router whether a
     * qualified, available, policy/budget-permitted candidate exists for this
     * task, and fails closed (never calling `provider`) when none does.
     * Absent (e.g. existing tests that construct this executor directly) —
     * the provider is called exactly as before, unrouted.
     */
    router?: Pick<ModelRouter, "routeInternal">;
    /**
     * EO-7: when supplied, a SUCCESSFUL call's real reported usage is recorded
     * into the Cost Center, keyed by `task.id` (idempotent — a retried task
     * never double-charges). Absent — usage is not recorded (e.g. existing
     * tests, or a deployment that has not composed the Cost Center).
     */
    usageLedger?: Pick<UsageLedger, "record">;
}
export declare class OpenAIAgentExecutor extends GeneralAgent<ControlPlaneAnalysisInput, ControlPlaneAnalysisResult> {
    private readonly options;
    protected readonly agentId = "control-plane-analysis-agent";
    protected readonly role = "control_plane_analyst";
    protected readonly limits: AgentLimits;
    constructor(options: OpenAIAgentExecutorOptions);
    protected validateInput(raw: unknown): ControlPlaneAnalysisInput;
    protected validateOutput(output: unknown): asserts output is ControlPlaneAnalysisResult;
    protected run(input: ControlPlaneAnalysisInput, task: Task, agent: Agent, run: AgentRun, _guard: PermissionGuard | undefined): Promise<ControlPlaneAnalysisResult>;
}
/**
 * Trusted production binding. Provider configuration is intentionally read on
 * first execution: importing the composition declaration never reads a secret,
 * while an attempted model execution still fails closed when configuration is
 * absent.
 *
 * `governance` is optional and additive (EO-7): supplying it routes every
 * call through the Model Router and records real usage into the Cost
 * Center; omitting it preserves the exact prior, unrouted behavior.
 */
export declare function createProductionOpenAIAgentExecutor(audit: AuditLog, governance?: {
    router?: Pick<ModelRouter, "routeInternal">;
    usageLedger?: Pick<UsageLedger, "record">;
}): OpenAIAgentExecutor;
export declare class LazyOpenAIModelProvider implements StructuredModelProvider {
    readonly id = "openai";
    private provider;
    generate(request: import("../../contracts/index.js").ModelRequest): Promise<import("../../contracts/index.js").ModelResponse>;
    generateStructured(request: import("../../contracts/index.js").StructuredModelRequest): Promise<import("../../contracts/index.js").ModelResponse>;
    private resolve;
}
