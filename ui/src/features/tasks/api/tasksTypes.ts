export type TaskStatus =
  | "queued"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused"
  | "blocked"
  | "unknown";

export type TaskPriority = "low" | "medium" | "high" | "critical" | "urgent";

export interface TaskLifecycleEvent {
  id: string;
  event: string;
  timestamp: string;
  status?: TaskStatus;
  details?: string;
}

export interface TaskExecutionSummary {
  executionId: string;
  status: "running" | "completed" | "failed" | "pending" | "cancelled";
  agentId?: string;
  agentName?: string;
  duration?: string;
  startedAt?: string;
  completedAt?: string;
  resultSummary?: string;
}

export interface TaskListItem {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: TaskPriority;
  type?: string;
  agentId?: string;
  agentName?: string;
  projectId?: string;
  projectName?: string;
  workflowId?: string;
  workflowName?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TaskDetail extends TaskListItem {
  startedAt?: string;
  completedAt?: string;
  dueAt?: string;
  timeline?: TaskLifecycleEvent[];
  executionSummary?: TaskExecutionSummary;
}

export interface TaskSummary {
  total: number;
  running: number;
  completed: number;
  failed: number;
  pending: number;
}

export interface TasksSnapshot {
  tasks: TaskListItem[];
  summary: TaskSummary;
}

export type TasksClientErrorCode =
  | "UNAUTHORIZED"
  | "DEGRADED"
  | "EMPTY"
  | "NOT_FOUND"
  | "NETWORK";

