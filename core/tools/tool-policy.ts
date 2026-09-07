/**
 * Pure tool-policy predicates. Deny-by-default: an agent / project is allowed
 * only if the tool explicitly lists it (or the `"*"` wildcard). Approval is
 * opt-in per tool. These are separated from the engine so they are independently
 * testable and reusable.
 */
import {
  type Environment,
  type Tool,
  type ToolApprovalRule,
  type ToolExecutionRequest,
  TOOL_WILDCARD,
} from "../../contracts/index.js";

export function agentAllowed(tool: Tool, agentId: string): boolean {
  return (
    tool.allowedAgents.includes(TOOL_WILDCARD) ||
    tool.allowedAgents.includes(agentId)
  );
}

export function projectAllowed(tool: Tool, projectId: string): boolean {
  return (
    tool.allowedProjects.includes(TOOL_WILDCARD) ||
    tool.allowedProjects.includes(projectId)
  );
}

export function environmentAllowed(
  tool: Tool,
  environment: Environment,
): boolean {
  return tool.allowedEnvironments.includes(environment);
}

export interface ToolApprovalRequirement {
  required: boolean;
  reason: string;
}

export function toolApprovalRequired(
  tool: Tool,
  request: Pick<ToolExecutionRequest, "environment" | "action">,
): ToolApprovalRequirement {
  const rule: ToolApprovalRule | undefined = tool.approvalPolicy;
  if (!rule) return { required: false, reason: "no approval policy" };
  if (rule.always) {
    return {
      required: true,
      reason: rule.reason ?? "tool always requires approval",
    };
  }
  if (rule.environments?.includes(request.environment)) {
    return {
      required: true,
      reason: rule.reason ?? `approval required in ${request.environment}`,
    };
  }
  if (rule.actions?.includes(request.action)) {
    return {
      required: true,
      reason: rule.reason ?? `approval required for action "${request.action}"`,
    };
  }
  return { required: false, reason: "approval policy not triggered" };
}
