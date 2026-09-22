/** Bounded, read-only production executor for Control Plane analysis tasks. */
import { type Agent, type AgentLimits, type PermissionGuard, type StructuredModelProvider, type Task } from "../../contracts/index.js";
import { AuditLog, AgentRun, GeneralAgent } from "../../core/index.js";
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
        model: string;
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
 */
export declare function createProductionOpenAIAgentExecutor(audit: AuditLog): OpenAIAgentExecutor;
