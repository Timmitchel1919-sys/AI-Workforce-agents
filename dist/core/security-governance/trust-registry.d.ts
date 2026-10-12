/**
 * Agent, model and tool trust.
 *
 * Agents default to TRUSTED while enabled (the operational enable/disable store
 * stays the switch for DISABLED); a SUSPENDED / DISABLED agent cannot execute
 * anything. Models carry data-handling policy: an external provider has a
 * maximum data class it may receive. Tools carry risk, environments, allowed
 * agents and approval rules; the built-in catalog mirrors the Layer 5 tools.
 */
import { type AgentTrustRecord, type DataClass, type GovEnvironment, type ModelTrustRecord, type GovRisk, type ToolTrustRecord, type TrustState } from "../../contracts/security-governance.js";
import type { Repository } from "../../contracts/persistence.js";
export interface TrustRepos {
    agents: Repository<AgentTrustRecord>;
    models: Repository<ModelTrustRecord>;
    tools: Repository<ToolTrustRecord>;
}
export declare class TrustRegistry {
    private readonly repos;
    private readonly clock;
    private readonly isAgentEnabled?;
    constructor(repos: TrustRepos, clock: () => string, isAgentEnabled?: ((agentId: string) => boolean) | undefined);
    agentState(agentId: string): TrustState;
    agentRecord(agentId: string): AgentTrustRecord;
    listAgents(knownAgentIds?: readonly string[]): AgentTrustRecord[];
    /** True when the agent must not execute anything. */
    isBlocked(agentId: string): boolean;
    setAgentState(agentId: string, state: TrustState, by: string, reason?: string, risk?: GovRisk): AgentTrustRecord;
    private defaultModel;
    modelRecord(provider: string, model: string): ModelTrustRecord;
    listModels(): ModelTrustRecord[];
    setModel(record: Omit<ModelTrustRecord, "id" | "updatedAt" | "updatedBy">, by: string): ModelTrustRecord;
    /** May `taskType` data of `dataClass` be sent to this model? */
    modelAllows(provider: string, model: string, taskType: string | undefined, dataClass: DataClass): {
        ok: boolean;
        reason: string;
    };
    listTools(): ToolTrustRecord[];
    toolRecord(toolId: string): ToolTrustRecord | undefined;
    setTool(record: Omit<ToolTrustRecord, "id" | "updatedAt" | "updatedBy">, by: string): ToolTrustRecord;
    /** Tool authorization BEFORE execution: unknown tools are refused (deny by default). */
    toolAllows(toolId: string | undefined, agentId: string | undefined, env: GovEnvironment): {
        ok: boolean;
        reason: string;
        approval: ToolTrustRecord["approval"];
    };
}
