export type SoftwareFactoryProgramStatus = "active" | "completed" | "failed" | "paused";
export type WorkstreamStatus = "active" | "completed" | "failed" | "paused";

export type TaskStatus =
  | "created"
  | "queued"
  | "running"
  | "blocked"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskEnvironmentRoutingStatus =
  | "routed"
  | "requires_provisioning"
  | "no_environment"
  | "unsupported"
  | "skipped";

export type TaskDependencyType = "blocking" | "informational";

export interface SoftwareFactoryTaskView {
  id: string;
  type: string;
  description: string;
  projectId: string;
  programId: string;
  workstreamId: string;
  assignedAgentId?: string;
  priority: string;
  status: TaskStatus;
  errors: readonly string[];
  createdAt: string;
  updatedAt: string;
  objective?: string;
  requirements: readonly string[];
  dependencies: readonly string[];
  requiredCapabilities: readonly string[];
  environmentRequirements: readonly string[];
  completionCriteria: readonly string[];
  riskClass?: string;
}

export interface SoftwareFactoryTaskInput {
  type: string;
  description: string;
  input?: unknown;
  priority?: string;
  metadata?: Record<string, unknown>;
  objective?: string;
  requirements?: readonly string[];
  dependencies?: readonly string[];
  requiredCapabilities?: readonly string[];
  environmentRequirements?: readonly string[];
  modelRequirements?: Record<string, unknown>;
  completionCriteria?: readonly string[];
  riskClass?: string;
}

export interface Workstream {
  schemaVersion: 1;
  id: string;
  projectId: string;
  programId: string;
  name: string;
  objective: string;
  status: WorkstreamStatus;
  tasks: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface SoftwareFactoryProgram {
  schemaVersion: 1;
  id: string;
  projectId: string;
  name: string;
  objective: string;
  status: SoftwareFactoryProgramStatus;
  workstreams: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface GraphNode {
  id: string;
  task: SoftwareFactoryTaskView;
  status: TaskStatus;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: TaskDependencyType;
}

export interface GraphProjection {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

export interface ProgramSummary {
  id: string;
  projectId: string;
  name: string;
  objective: string;
  status: SoftwareFactoryProgramStatus;
  workstreamIds: readonly string[];
  taskCount: number;
  activeTaskCount: number;
  updatedAt: string;
}

export interface SoftwareFactoryOverview {
  programs: readonly ProgramSummary[];
}

export interface TaskEnvironmentRoutingSummary {
  taskId: string;
  code: string;
  status: TaskEnvironmentRoutingStatus;
  detail: string;
}

export interface SoftwareFactoryProgramDetail {
  program: SoftwareFactoryProgram;
  workstreams: readonly Workstream[];
  graph: GraphProjection;
  routes: readonly TaskEnvironmentRoutingSummary[];
}

export interface CreateProgramInput {
  projectId: string;
  id: string;
  name: string;
  objective: string;
}

export interface CreateWorkstreamInput {
  projectId: string;
  programId: string;
  id: string;
  name: string;
  objective: string;
}

export interface AddWorkstreamTaskInput {
  projectId: string;
  programId: string;
  workstreamId: string;
  task: SoftwareFactoryTaskInput;
}

export interface TickSoftwareFactoryInput {
  projectId: string;
  programId: string;
}

export interface SoftwareFactoryCommandResult {
  command:
    | "create_program"
    | "create_workstream"
    | "add_task_to_workstream"
    | "tick_software_factory";
  outcome: "executed" | "denied" | "rejected";
  ok: boolean;
  errorKind?:
    | "invalid_request"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "invalid_state"
    | "approval_failure"
    | "command_failure";
  reason: string;
  resourceId?: string;
  correlationId: string;
  details: Record<string, unknown>;
  auditEventId: string;
  timestamp: string;
}

export type SoftwareFactoryClientErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"
  | "DEGRADED"
  | "NETWORK";
