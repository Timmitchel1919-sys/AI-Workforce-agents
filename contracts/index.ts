export const TASK_STATUSES = ["created", "queued", "running", "blocked", "awaiting_approval", "completed", "failed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type PermissionAction = "read" | "write" | "execute" | "deploy" | "external_communication" | "secret_access";
export type Environment = "local" | "test" | "staging" | "production";
export type Priority = "low" | "normal" | "high" | "critical";

export interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: readonly string[];
  allowedTools: readonly string[];
  allowedProjects: readonly string[];
  permissions: readonly PermissionGrant[];
  supportedTaskTypes: readonly string[];
  modelPolicy?: { provider?: string; model?: string };
}

export interface Task {
  id: string;
  type: string;
  description: string;
  projectId: string;
  assignedAgentId?: string;
  priority: Priority;
  status: TaskStatus;
  input: unknown;
  output?: unknown;
  errors: string[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface Handoff {
  id: string;
  sourceAgentId: string;
  destinationAgentId: string;
  taskId: string;
  context: Record<string, unknown>;
  completedWork: string;
  remainingWork: string;
  acceptanceCriteria: readonly string[];
  artifacts: readonly string[];
  risks: readonly string[];
  createdAt: string;
}

export interface PermissionGrant {
  agentId?: string;
  projectId?: string;
  toolId?: string;
  action: PermissionAction;
  environment?: Environment;
  effect: "allow" | "deny";
}

export interface PermissionRequest {
  agentId: string;
  projectId: string;
  toolId?: string;
  action: PermissionAction;
  environment: Environment;
}

export type ApprovalStatus = "requested" | "approved" | "rejected" | "expired";
export interface Approval {
  id: string;
  requestedBy: string;
  action: string;
  reason: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  expiresAt?: string;
  decisionMetadata: Record<string, unknown>;
}

export interface ScopedContext {
  taskId: string;
  projectId: string;
  agentId?: string;
  values: Record<string, unknown>;
}

export type AuditEventType = "task_created" | "task_assigned" | "agent_executed" | "handoff_created" | "permission_granted" | "permission_denied" | "approval_requested" | "approval_decided" | "task_completed" | "task_failed";
export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: string;
  taskId?: string;
  agentId?: string;
  projectId?: string;
  data: Record<string, unknown>;
}

export interface ModelProvider {
  id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}
export interface ModelRequest { messages: readonly { role: "system" | "user" | "assistant"; content: string }[]; model?: string; metadata?: Record<string, unknown>; }
export interface ModelResponse { content: string; model: string; usage?: { inputTokens?: number; outputTokens?: number }; }
export interface ToolProvider { id: string; execute(request: ToolRequest): Promise<ToolResponse>; }
export interface ToolRequest { tool: string; input: unknown; context: ScopedContext; }
export interface ToolResponse { output: unknown; metadata?: Record<string, unknown>; }
export interface ProjectAdapter { projectId: string; describe(): Promise<{ name: string; capabilities: readonly string[] }>; execute(operation: string, input: unknown): Promise<unknown>; }

export function assertNonBlank(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required`);
}

export function validateAgent(agent: Agent): void {
  assertNonBlank(agent.id, "agent.id"); assertNonBlank(agent.name, "agent.name");
  if (!agent.capabilities.length) throw new Error("agent.capabilities must not be empty");
}

export function validateTaskInput(input: Pick<Task, "type" | "description" | "projectId">): void {
  assertNonBlank(input.type, "task.type"); assertNonBlank(input.description, "task.description"); assertNonBlank(input.projectId, "task.projectId");
}

export function validateHandoff(handoff: Handoff): void {
  assertNonBlank(handoff.sourceAgentId, "handoff.sourceAgentId");
  assertNonBlank(handoff.destinationAgentId, "handoff.destinationAgentId");
  assertNonBlank(handoff.taskId, "handoff.taskId");
  if (handoff.sourceAgentId === handoff.destinationAgentId) throw new Error("handoff agents must differ");
  if (!handoff.acceptanceCriteria.length) throw new Error("handoff.acceptanceCriteria must not be empty");
}
