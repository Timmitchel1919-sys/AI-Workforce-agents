/**
 * Pure(ish) helpers the `WorkflowEngine` uses to walk the task graph and
 * validate agent assignments. Kept separate from the engine so scheduling
 * logic and assignment validation are independently testable — mirrors the
 * `core/tools/tool-policy.ts` split from `ToolExecutionEngine`.
 */
import {
  type AgentAssignment,
  type RetryPolicy,
  type Workflow,
  type WorkflowTaskRecord,
  type WorkflowTaskSpec,
} from "../../contracts/index.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { PermissionSystem } from "../permissions/permission-system.js";
import { ToolRegistry } from "../tools/tool-registry.js";

/** Spec ids whose dependencies have all completed and which have not started. */
export function computeReadySpecs(workflow: Workflow): WorkflowTaskSpec[] {
  const recordBySpec = new Map(
    workflow.taskRecords.map((record) => [record.specId, record]),
  );
  return workflow.tasks.filter((spec) => {
    const record = recordBySpec.get(spec.id);
    if (!record || record.status !== "pending") return false;
    return spec.dependsOn.every(
      (dep) => recordBySpec.get(dep)?.status === "completed",
    );
  });
}

/** True while any task could still run or is waiting on something. */
export function hasActionableWork(workflow: Workflow): boolean {
  return workflow.taskRecords.some((record) =>
    ["pending", "ready", "dispatched", "awaiting_approval"].includes(
      record.status,
    ),
  );
}

/**
 * Validate (never blindly trust) an agent assignment for a task spec: the
 * agent must exist, be declared in `workflow.participatingAgents`, be eligible
 * for the task's type + project, and — when a capability was requested —
 * actually hold it. Tool expectations are checked against the `ToolRegistry`
 * when supplied.
 */
export function assignAgent(
  spec: WorkflowTaskSpec,
  workflow: Workflow,
  registry: AgentRegistry,
  permissions: PermissionSystem,
  toolRegistry?: ToolRegistry,
): AgentAssignment {
  const candidateId =
    spec.agentId ??
    registry
      .eligible(spec.type, workflow.projectId)
      .find(
        (agent) =>
          workflow.participatingAgents.includes(agent.id) &&
          (!spec.capability || agent.capabilities.includes(spec.capability)),
      )?.id;

  if (!candidateId) {
    return {
      specId: spec.id,
      validated: false,
      reason: spec.agentId
        ? `no candidate resolved for explicit agentId "${spec.agentId}"`
        : `no participating agent has capability "${spec.capability}" for type "${spec.type}"`,
    };
  }

  const agent = registry.get(candidateId);
  if (!agent) {
    return {
      specId: spec.id,
      agentId: candidateId,
      validated: false,
      reason: `agent "${candidateId}" is not registered`,
    };
  }
  if (!workflow.participatingAgents.includes(candidateId)) {
    return {
      specId: spec.id,
      agentId: candidateId,
      validated: false,
      reason: `agent "${candidateId}" is not a declared participant of this workflow`,
    };
  }
  const eligible = registry
    .eligible(spec.type, workflow.projectId)
    .some((a) => a.id === candidateId);
  if (!eligible) {
    return {
      specId: spec.id,
      agentId: candidateId,
      validated: false,
      reason: `agent "${candidateId}" is not eligible for type "${spec.type}" on project "${workflow.projectId}"`,
    };
  }
  if (spec.capability && !agent.capabilities.includes(spec.capability)) {
    return {
      specId: spec.id,
      agentId: candidateId,
      validated: false,
      reason: `agent "${candidateId}" lacks capability "${spec.capability}"`,
    };
  }
  for (const toolId of spec.expectedTools) {
    const tool = toolRegistry?.get(toolId);
    if (toolRegistry && (!tool || !tool.allowedAgents.includes(candidateId))) {
      return {
        specId: spec.id,
        agentId: candidateId,
        validated: false,
        reason: `agent "${candidateId}" is not authorized for expected tool "${toolId}"`,
      };
    }
  }

  // Permission existence is an informational pre-check; the Orchestrator /
  // ToolExecutionEngine remain the actual enforcement points at dispatch time.
  const permissionNotes = spec.requiredPermissions.map((req) => {
    const decision = permissions.evaluate({
      action: req.action,
      toolId: req.toolId,
      agentId: candidateId,
      projectId: workflow.projectId,
      environment: "local",
    });
    return `${req.action}${req.toolId ? `/${req.toolId}` : ""}:${decision.allowed ? "allow" : "deny"}`;
  });

  return {
    specId: spec.id,
    agentId: candidateId,
    validated: true,
    reason:
      permissionNotes.length > 0
        ? `assigned; permissions[${permissionNotes.join(",")}]`
        : "assigned",
  };
}

/**
 * `AgentExecutionError` (and the orchestrator's own failures) format their
 * message as `[agentId:reason] message`. Retry policy reads the `reason` back
 * out of that convention rather than re-deriving it — documented coupling.
 */
export function extractFailureReason(message: string): string | undefined {
  const match = /^\[[^:]+:([\w-]+)]/.exec(message);
  return match?.[1];
}

export function shouldRetry(
  policy: RetryPolicy,
  reason: string | undefined,
  retryCountSoFar: number,
): boolean {
  if (retryCountSoFar >= policy.maxRetries) return false;
  if (!reason) return false;
  return policy.retryableReasons.includes(reason);
}

/** Read `output.metadata.counters.toolCalls` when a General Agent provided it. */
export function extractToolCallCount(output: unknown): number {
  if (!output || typeof output !== "object") return 0;
  const metadata = (output as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return 0;
  const counters = (metadata as { counters?: unknown }).counters;
  if (!counters || typeof counters !== "object") return 0;
  const toolCalls = (counters as { toolCalls?: unknown }).toolCalls;
  return typeof toolCalls === "number" ? toolCalls : 0;
}

export function initialTaskRecord(
  specId: string,
  now: string,
): WorkflowTaskRecord {
  return {
    specId,
    status: "pending",
    retryCount: 0,
    updatedAt: now,
  };
}
