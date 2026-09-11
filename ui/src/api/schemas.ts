/**
 * Runtime boundary validation for Control Plane responses.
 *
 * The authoritative types live in `contracts.ts` (re-exported from the backend).
 * These Zod schemas guard against a *malformed* response silently corrupting UI
 * state — they check the top-level shape, enums, pagination, critical IDs and
 * timestamps, and `.passthrough()` everything else so new backend fields never
 * break the client. A parsed value is cast to the authoritative contract type.
 */
import { z } from "zod";
import type {
  AgentView,
  ApprovalView,
  AuditEventView,
  ControlCommandResult,
  DashboardSnapshot,
  PageResult,
  ProjectView,
  SystemHealth,
  TaskView,
  ToolView,
  WorkflowView,
  WorkforceStatus,
} from "./contracts";

const iso = z.string().min(1);

export const healthStatusSchema = z.enum([
  "healthy",
  "degraded",
  "unavailable",
  "unknown",
]);
export const agentStatusSchema = z.enum([
  "idle",
  "available",
  "busy",
  "blocked",
  "waiting",
  "failed",
  "disabled",
]);
export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export const commandOutcomeSchema = z.enum(["executed", "denied", "rejected"]);

const agentViewSchema = z
  .object({ agentId: z.string().min(1), status: agentStatusSchema })
  .passthrough();

const taskViewSchema = z
  .object({
    taskId: z.string().min(1),
    status: z.string(),
    createdAt: iso,
    updatedAt: iso,
  })
  .passthrough();

const workflowViewSchema = z
  .object({
    workflowId: z.string().min(1),
    status: z.string(),
    progress: z
      .object({ completed: z.number(), total: z.number() })
      .passthrough(),
  })
  .passthrough();

const approvalViewSchema = z
  .object({
    approvalId: z.string().min(1),
    status: z.string(),
    risk: riskLevelSchema,
    requestedAt: iso,
  })
  .passthrough();

const projectViewSchema = z
  .object({
    projectId: z.string().min(1),
    status: z.string(),
    adapterStatus: healthStatusSchema,
  })
  .passthrough();

const toolViewSchema = z
  .object({ toolId: z.string().min(1), name: z.string() })
  .passthrough();

const auditEventViewSchema = z
  .object({ id: z.string().min(1), type: z.string(), timestamp: iso })
  .passthrough();

const systemHealthSchema = z
  .object({
    status: healthStatusSchema,
    generatedAt: iso,
    components: z.array(
      z
        .object({
          name: z.string(),
          status: healthStatusSchema,
          detail: z.string(),
          checkedAt: iso,
        })
        .passthrough(),
    ),
  })
  .passthrough();

const workforceStatusSchema = z
  .object({
    status: healthStatusSchema,
    generatedAt: iso,
    counts: z.record(z.string(), z.number()),
  })
  .passthrough();

const dashboardSnapshotSchema = z
  .object({
    generatedAt: iso,
    operator: z.object({ id: z.string(), role: z.string() }).passthrough(),
    agents: z.array(agentViewSchema),
    workflows: z.array(workflowViewSchema),
    tasks: z.array(taskViewSchema),
    approvals: z.array(approvalViewSchema),
    projects: z.array(projectViewSchema),
    tools: z.array(toolViewSchema),
  })
  .passthrough();

const commandResultSchema = z
  .object({
    command: z.string(),
    outcome: commandOutcomeSchema,
    ok: z.boolean(),
    reason: z.string(),
    correlationId: z.string(),
    auditEventId: z.string(),
    timestamp: iso,
  })
  .passthrough();

function pageResultSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      items: z.array(item),
      total: z.number(),
      nextCursor: z.string().nullable(),
    })
    .passthrough();
}

const livenessSchema = z.object({ status: z.string() }).passthrough();

/**
 * Boundary parsers. Each validates the essential shape and returns the value
 * typed as the authoritative contract (the schema is intentionally partial +
 * `.passthrough()`, so the cast goes through `unknown`). Throws on a shape
 * mismatch — the API client turns that into a `malformed_response` `ApiError`.
 */
export const parse = {
  liveness: (d: unknown): { status: string } => livenessSchema.parse(d),
  systemHealth: (d: unknown): SystemHealth =>
    systemHealthSchema.parse(d) as unknown as SystemHealth,
  workforceStatus: (d: unknown): WorkforceStatus =>
    workforceStatusSchema.parse(d) as unknown as WorkforceStatus,
  dashboard: (d: unknown): DashboardSnapshot =>
    dashboardSnapshotSchema.parse(d) as unknown as DashboardSnapshot,
  agentList: (d: unknown): AgentView[] =>
    z.array(agentViewSchema).parse(d) as unknown as AgentView[],
  agent: (d: unknown): AgentView =>
    agentViewSchema.parse(d) as unknown as AgentView,
  taskPage: (d: unknown): PageResult<TaskView> =>
    pageResultSchema(taskViewSchema).parse(
      d,
    ) as unknown as PageResult<TaskView>,
  task: (d: unknown): TaskView =>
    taskViewSchema.parse(d) as unknown as TaskView,
  workflowList: (d: unknown): WorkflowView[] =>
    z.array(workflowViewSchema).parse(d) as unknown as WorkflowView[],
  workflow: (d: unknown): WorkflowView =>
    workflowViewSchema.parse(d) as unknown as WorkflowView,
  approvalList: (d: unknown): ApprovalView[] =>
    z.array(approvalViewSchema).parse(d) as unknown as ApprovalView[],
  projectList: (d: unknown): ProjectView[] =>
    z.array(projectViewSchema).parse(d) as unknown as ProjectView[],
  project: (d: unknown): ProjectView =>
    projectViewSchema.parse(d) as unknown as ProjectView,
  toolList: (d: unknown): ToolView[] =>
    z.array(toolViewSchema).parse(d) as unknown as ToolView[],
  tool: (d: unknown): ToolView =>
    toolViewSchema.parse(d) as unknown as ToolView,
  auditPage: (d: unknown): PageResult<AuditEventView> =>
    pageResultSchema(auditEventViewSchema).parse(
      d,
    ) as unknown as PageResult<AuditEventView>,
  commandResult: (d: unknown): ControlCommandResult =>
    commandResultSchema.parse(d) as unknown as ControlCommandResult,
};
