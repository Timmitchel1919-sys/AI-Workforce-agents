import type { Agent } from "../../contracts/index.js";
import type { AgentAssignmentEvidence, OrchTask } from "../../contracts/execution-orchestration.js";
export interface OrchAgentRouteInput {
    task: Pick<OrchTask, "projectId" | "type" | "risk" | "requiredCapabilities" | "excludedAgents" | "destructive">;
    /** The task approval was already granted (gated write tools may then be needed). */
    approved: boolean;
    agents: readonly Agent[];
    isEnabled?: (agentId: string) => boolean;
    workload?: (agentId: string) => number;
    /** Extra exclusions (e.g. the implementer, for an independent reviewer). */
    exclude?: readonly string[];
}
export interface OrchAgentRouteResult {
    selected?: AgentAssignmentEvidence;
    /** Every other agent and why it did not qualify. */
    rejected: {
        agentId: string;
        reasons: string[];
    }[];
    /** Present when nobody qualified. */
    reason?: string;
}
export declare class AgentRouter {
    route(input: OrchAgentRouteInput): OrchAgentRouteResult;
}
