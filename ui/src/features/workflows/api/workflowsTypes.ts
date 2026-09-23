/**
 * Mirrors the Control Plane `WorkflowView` / `PageResult` contracts
 * (contracts/control.ts) served by `GET /api/workflows[/:id]`.
 */

export type WorkflowStatus =
  | "created"
  | "planned"
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowStageStatus =
  | "pending"
  | "ready"
  | "dispatched"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export interface WorkflowStage {
  specId: string;
  type: string;
  description: string;
  status: WorkflowStageStatus | string;
  assignedAgentId?: string;
  retryCount: number;
  error?: string;
}

export interface WorkflowProgress {
  completed: number;
  total: number;
  failed: number;
  blocked: number;
  /** 0..1, rounded to two decimals by the backend. */
  fraction: number;
}

export interface WorkflowView {
  workflowId: string;
  name: string;
  description: string;
  projectId: string;
  status: WorkflowStatus | string;
  paused: boolean;
  pauseReason?: string;
  progress: WorkflowProgress;
  currentSpecId?: string;
  pendingApprovals: number;
  participatingAgents: readonly string[];
  stages: readonly WorkflowStage[];
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowsPage {
  items: readonly WorkflowView[];
  total: number;
  nextCursor: string | null;
}

export type WorkflowsClientErrorCode =
  | "UNAUTHORIZED"
  | "DEGRADED"
  | "NOT_FOUND"
  | "NETWORK";
