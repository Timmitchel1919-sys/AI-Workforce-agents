/**
 * Pure tool-policy predicates. Deny-by-default: an agent / project is allowed
 * only if the tool explicitly lists it (or the `"*"` wildcard). Approval is
 * opt-in per tool. These are separated from the engine so they are independently
 * testable and reusable.
 */
import { type Environment, type Tool, type ToolExecutionRequest } from "../../contracts/index.js";
export declare function agentAllowed(tool: Tool, agentId: string): boolean;
export declare function projectAllowed(tool: Tool, projectId: string): boolean;
export declare function environmentAllowed(tool: Tool, environment: Environment): boolean;
export interface ToolApprovalRequirement {
    required: boolean;
    reason: string;
}
export declare function toolApprovalRequired(tool: Tool, request: Pick<ToolExecutionRequest, "environment" | "action">): ToolApprovalRequirement;
