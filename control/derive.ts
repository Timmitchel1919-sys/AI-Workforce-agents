/**
 * Pure functions that turn core state into Control-Plane view models. No
 * side effects, no I/O — deterministic given their inputs.
 */
import {
  type Agent,
  type AgentOperationalRecord,
  type AgentOperationalStatus,
  type AgentView,
  type Approval,
  type ApprovalView,
  type AuditEvent,
  type AuditEventView,
  type Task,
  type TaskView,
  type Tool,
  type ToolExecutionStats,
  type ToolView,
  type Workflow,
  type WorkflowControlRecord,
  type WorkflowStageView,
  type WorkflowView,
} from "../contracts/index.js";
import { extractFailureReason } from "../core/workflows/workflow-graph.js";
import { keyNames, redact, redactText } from "./redaction.js";
import { classifyApprovalRisk } from "./risk.js";

/* ------------------------------------------------------------------ */
/* Agents                                                             */
/* ------------------------------------------------------------------ */

function agentRole(agent: Agent): string {
  const role = (agent.metadata as { role?: unknown } | undefined)?.role;
  return typeof role === "string" ? role : agent.id.replace(/-agent$/, "");
}

export function deriveAgentStatus(
  agentId: string,
  enabled: boolean,
  agentTasks: readonly Task[],
): AgentOperationalStatus {
  if (!enabled) return "disabled";
  if (agentTasks.length === 0) return "idle";
  if (agentTasks.some((t) => t.status === "running")) return "busy";
  if (agentTasks.some((t) => t.status === "awaiting_approval"))
    return "waiting";
  if (agentTasks.some((t) => t.status === "blocked")) return "blocked";

  const latest = [...agentTasks].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1,
  )[0]!;
  if (latest.status === "failed") return "failed";
  return "available";
}

export function deriveAgentView(
  agent: Agent,
  allTasks: readonly Task[],
  opsRecord: AgentOperationalRecord | undefined,
  audit: readonly AuditEvent[],
): AgentView {
  const enabled = opsRecord ? opsRecord.enabled : true;
  const mine = allTasks.filter((t) => t.assignedAgentId === agent.id);
  const status = deriveAgentStatus(agent.id, enabled, mine);

  const completed = mine.filter((t) => t.status === "completed").length;
  const failed = mine.filter((t) => t.status === "failed").length;
  const cancelled = mine.filter((t) => t.status === "cancelled").length;
  const decided = completed + failed;

  const active = mine.find(
    (t) => t.status === "running" || t.status === "awaiting_approval",
  );

  const taskTimes = mine.map((t) => t.updatedAt);
  const auditTimes = audit
    .filter((e) => e.agentId === agent.id)
    .map((e) => e.timestamp);
  const lastActivityAt = [...taskTimes, ...auditTimes].sort().at(-1);

  return {
    agentId: agent.id,
    name: agent.name,
    role: agentRole(agent),
    capabilities: [...agent.capabilities],
    status,
    enabled,
    disabledReason: enabled ? undefined : opsRecord?.disabledReason,
    currentTaskId: active?.id,
    currentProjectId: active?.projectId,
    allowedProjects: [...agent.allowedProjects],
    lastActivityAt,
    stats: {
      taskCount: mine.length,
      completed,
      failed,
      cancelled,
      successRate: decided === 0 ? null : completed / decided,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

function metaString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

export function deriveTaskView(
  task: Task,
  workflow: Workflow | undefined,
  approval: Approval | undefined,
  options: { includeInputShape?: boolean } = {},
): TaskView {
  const workflowId = metaString(task.metadata, "workflowId");
  const specId = metaString(task.metadata, "specId");
  const record = specId
    ? workflow?.taskRecords.find((r) => r.specId === specId)
    : undefined;
  const spec = specId
    ? workflow?.tasks.find((t) => t.id === specId)
    : undefined;

  const lastError = task.errors.at(-1);
  const controlRetries = task.metadata.controlRetryCount;

  return {
    taskId: task.id,
    type: task.type,
    description: task.description,
    projectId: task.projectId,
    status: task.status,
    priority: task.priority,
    assignedAgentId: task.assignedAgentId,
    workflowId,
    workflowSpecId: specId,
    dependsOn: spec ? [...spec.dependsOn] : [],
    retryCount:
      record?.retryCount ??
      (typeof controlRetries === "number" ? controlRetries : 0),
    failureReason: lastError ? extractFailureReason(lastError) : undefined,
    lastError: lastError ? redactText(lastError) : undefined,
    approvalId: task.approvalId,
    approvalState: approval?.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    redactedInputKeys: options.includeInputShape
      ? keyNames(task.input)
      : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Workflows                                                          */
/* ------------------------------------------------------------------ */

export function deriveWorkflowView(
  workflow: Workflow,
  control: WorkflowControlRecord | undefined,
  approvalsForWorkflow: readonly Approval[],
): WorkflowView {
  const records = workflow.taskRecords;
  const completed = records.filter((r) => r.status === "completed").length;
  const failed = records.filter((r) => r.status === "failed").length;
  const blocked = records.filter(
    (r) => r.status === "blocked" || r.status === "skipped",
  ).length;
  const total = records.length || 1;

  const current = records.find(
    (r) => r.status === "dispatched" || r.status === "awaiting_approval",
  )?.specId;

  const stages: WorkflowStageView[] = workflow.tasks.map((spec) => {
    const record = records.find((r) => r.specId === spec.id);
    return {
      specId: spec.id,
      type: spec.type,
      description: spec.description,
      status: record?.status ?? "pending",
      assignedAgentId: record?.assignedAgentId,
      retryCount: record?.retryCount ?? 0,
      error: record?.error ? redactText(record.error) : undefined,
    };
  });

  return {
    workflowId: workflow.id,
    name: workflow.name,
    description: workflow.description,
    projectId: workflow.projectId,
    status: workflow.status,
    paused: control?.paused ?? false,
    pauseReason: control?.paused ? control.pauseReason : undefined,
    progress: {
      completed,
      total: records.length,
      failed,
      blocked,
      fraction:
        records.length === 0 ? 0 : Math.round((completed / total) * 100) / 100,
    },
    currentSpecId: current,
    pendingApprovals: approvalsForWorkflow.filter(
      (a) => a.status === "requested",
    ).length,
    participatingAgents: [...workflow.participatingAgents],
    stages,
    startedAt: workflow.startedAt,
    updatedAt: workflow.updatedAt,
    completedAt: workflow.completedAt,
    error: workflow.error ? redactText(workflow.error) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Approvals                                                          */
/* ------------------------------------------------------------------ */

/** Pull `toolId` out of an action like `tool:money-mind.read-status:read`. */
export function parseApprovalAction(action: string): {
  toolId?: string;
  kind: string;
} {
  const parts = action.split(":");
  if (parts[0] === "tool" && parts.length >= 2) {
    return { toolId: parts[1], kind: "tool" };
  }
  return { kind: parts[0] || "task" };
}

export function deriveApprovalView(approval: Approval): ApprovalView {
  const meta = approval.decisionMetadata ?? {};
  const parsed = parseApprovalAction(approval.action);
  return {
    approvalId: approval.id,
    status: approval.status,
    action: approval.action,
    risk: classifyApprovalRisk(approval),
    requestedBy: approval.requestedBy,
    reason: approval.reason,
    taskId: metaString(meta, "taskId"),
    workflowId: metaString(meta, "workflowId"),
    toolId: parsed.toolId ?? metaString(meta, "toolId"),
    agentId: metaString(meta, "agentId"),
    projectId: metaString(meta, "projectId"),
    requestedAt: approval.requestedAt,
    expiresAt: approval.expiresAt,
    decidedBy: approval.decidedBy,
    decidedAt: approval.decidedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Tools                                                              */
/* ------------------------------------------------------------------ */

export function deriveToolStats(
  toolId: string,
  audit: readonly AuditEvent[],
): ToolExecutionStats {
  const events = audit.filter(
    (e) =>
      e.type === "tool_execution" &&
      (e.data as { toolId?: string }).toolId === toolId,
  );
  const phase = (e: AuditEvent): string =>
    String((e.data as { phase?: unknown }).phase ?? "");
  return {
    total: events.filter((e) => phase(e) === "requested").length,
    completed: events.filter((e) => phase(e) === "completed").length,
    failed: events.filter((e) => phase(e) === "failed").length,
    denied: events.filter((e) => phase(e) === "denied").length,
    timedOut: events.filter((e) => phase(e) === "timeout").length,
    approvalRequired: events.filter((e) => phase(e) === "approval_required")
      .length,
  };
}

export function deriveToolView(
  tool: Tool,
  audit: readonly AuditEvent[],
): ToolView {
  return {
    toolId: tool.id,
    name: tool.name,
    version: tool.version,
    capabilities: [...tool.capabilities],
    allowedAgents: [...tool.allowedAgents],
    allowedProjects: [...tool.allowedProjects],
    allowedEnvironments: [...tool.allowedEnvironments],
    requiredPermission: tool.requiredPermission.action,
    approvalRequired: tool.approvalPolicy !== undefined,
    stats: deriveToolStats(tool.id, audit),
  };
}

/* ------------------------------------------------------------------ */
/* Audit                                                              */
/* ------------------------------------------------------------------ */

const OUTCOME_KEYS = [
  "outcome",
  "verdict",
  "decision",
  "status",
  "allowed",
  "assigned",
  "kind",
  "phase",
] as const;

function deriveOutcome(event: AuditEvent): string | undefined {
  if (event.type === "task_completed") return "completed";
  if (event.type === "task_failed") return "failed";
  for (const key of OUTCOME_KEYS) {
    const value = (event.data as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value ? "allowed" : "denied";
  }
  return undefined;
}

function deriveActor(event: AuditEvent): string | undefined {
  const data = event.data as Record<string, unknown>;
  for (const key of ["actor", "decidedBy", "operator", "requestedBy", "by"]) {
    if (typeof data[key] === "string") return data[key] as string;
  }
  return event.agentId ?? undefined;
}

export function deriveAuditEventView(event: AuditEvent): AuditEventView {
  const data = event.data as Record<string, unknown>;
  const nested = (key: string): string | undefined =>
    typeof data[key] === "string" ? (data[key] as string) : undefined;
  return {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    actor: deriveActor(event),
    taskId: event.taskId ?? nested("taskId"),
    agentId: event.agentId ?? nested("agentId"),
    projectId: event.projectId ?? nested("projectId"),
    workflowId: nested("workflowId"),
    toolId: nested("toolId"),
    outcome: deriveOutcome(event),
    data: redact(data),
  };
}

/* ------------------------------------------------------------------ */
/* Cursor pagination (opaque, deterministic)                          */
/* ------------------------------------------------------------------ */

const DEFAULT_PAGE = 25;
const MAX_PAGE = 200;

export function paginate<T>(
  items: readonly T[],
  limit: number | undefined,
  cursor: string | undefined,
): { items: T[]; total: number; nextCursor: string | null } {
  const size = Math.min(Math.max(1, limit ?? DEFAULT_PAGE), MAX_PAGE);
  const start = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  const slice = items.slice(start, start + size);
  const next = start + size;
  return {
    items: slice,
    total: items.length,
    nextCursor: next < items.length ? String(next) : null,
  };
}
