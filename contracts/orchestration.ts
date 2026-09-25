import { Task } from "./index.js";

export type SoftwareFactoryProgramStatus =
  | "active"
  | "completed"
  | "failed"
  | "paused";

export type WorkstreamStatus =
  | "active"
  | "completed"
  | "failed"
  | "paused";

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
  type: "blocking" | "informational";
}

export interface GraphNode {
  id: string;
  task: Task;
  status: Task["status"];
}

export interface GraphEdge {
  from: string;
  to: string;
  type: TaskDependency["type"];
}

export interface GraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Workstream {
  id: string;
  programId: string;
  name: string;
  objective: string;
  status: WorkstreamStatus;
  tasks: string[]; // Task IDs
  createdAt: string;
  updatedAt: string;
}

export interface SoftwareFactoryProgram {
  id: string;
  name: string;
  objective: string;
  status: SoftwareFactoryProgramStatus;
  workstreams: string[]; // Workstream IDs
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Control-plane views (shaped for the UI; no runtime state leaks)     */
/* ------------------------------------------------------------------ */

export interface ProgramSummary {
  id: string;
  name: string;
  objective: string;
  status: SoftwareFactoryProgramStatus;
  workstreamIds: readonly string[];
  taskCount: number;
  /** Tasks that are not yet completed/cancelled/failed. */
  activeTaskCount: number;
  updatedAt: string;
}

export interface SoftwareFactoryOverview {
  programs: readonly ProgramSummary[];
}

/**
 * Redacted routing verdict for one task. The full `EnvironmentCodeRoute`
 * stays server-side; only this light status crosses the API.
 */
export interface TaskEnvironmentRoutingSummary {
  taskId: string;
  code: string;
  status:
    | "routed"
    | "requires_provisioning"
    | "no_environment"
    | "unsupported"
    | "skipped";
  detail: string;
}

export interface SoftwareFactoryProgramDetail {
  program: SoftwareFactoryProgram;
  workstreams: readonly Workstream[];
  graph: GraphProjection;
  routes: readonly TaskEnvironmentRoutingSummary[];
}