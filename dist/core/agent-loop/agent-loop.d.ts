/**
 * LlmAgentExecutor (Layer 6) — the LLM agent loop behind `AgentExecutorPort`.
 *
 *   brief + recent results ─► model ─► ONE JSON action ─► validated
 *     ─► governed tool session (permissions, path guard, command policy,
 *        approvals, cancel/pause) ─► bounded masked observation ─► repeat
 *
 * The model never executes anything. It proposes actions; the tool session
 * decides. Success is never taken on the model's word: evidence and checks are
 * computed from the real tool records, authoring needs real changes, and a
 * review needs real inspection.
 */
import type { ModelProvider } from "../../contracts/index.js";
import type { RuntimeOutcome } from "../execution-orchestration/ports.js";
import type { AgentExecutorPort, AgentWork } from "../execution-runtime/runtime.js";
export interface AgentLoopLimits {
    maxSteps: number;
    maxModelCalls: number;
    /** Consecutive unparseable replies tolerated. */
    maxMalformedInRow: number;
    maxMalformedTotal: number;
    /** Refused actions (permission, path, command policy) tolerated. */
    maxRefusals: number;
    /** The identical action repeated this many times is flagged, then fatal. */
    repeatWarn: number;
    repeatFail: number;
    maxTokens: number;
    maxWallMs: number;
    fileObservationChars: number;
    commandObservationChars: number;
    recentSteps: number;
    progressLines: number;
}
export declare const DEFAULT_AGENT_LOOP_LIMITS: AgentLoopLimits;
export interface AgentLoopDeps {
    /** One model provider per call: the caller wires routing + metering per agent. */
    models: (input: {
        agentId: string;
        projectId: string;
    }) => ModelProvider;
    limits?: Partial<AgentLoopLimits>;
    now?: () => number;
}
export declare class LlmAgentExecutor implements AgentExecutorPort {
    private readonly deps;
    private readonly limits;
    private readonly now;
    constructor(deps: AgentLoopDeps);
    perform(work: AgentWork): Promise<RuntimeOutcome>;
    private render;
    private refusal;
    private finishProblem;
    private outcome;
    private act;
}
