import type { Task, TaskDraft } from "./index.js";
export type SoftwareFactoryProgramStatus = "active" | "completed" | "failed" | "paused";
export type WorkstreamStatus = "active" | "completed" | "failed" | "paused";
export interface TaskDependency {
    taskId: string;
    dependsOnTaskId: string;
    type: "blocking" | "informational";
}
export declare const SOFTWARE_FACTORY_SCHEMA_VERSION: 1;
export interface SoftwareFactoryTaskView {
    id: string;
    type: string;
    description: string;
    projectId: string;
    programId: string;
    workstreamId: string;
    assignedAgentId?: string;
    priority: Task["priority"];
    status: Task["status"];
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
export interface GraphNode {
    id: string;
    task: SoftwareFactoryTaskView;
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
    schemaVersion: typeof SOFTWARE_FACTORY_SCHEMA_VERSION;
    id: string;
    projectId: string;
    programId: string;
    name: string;
    objective: string;
    status: WorkstreamStatus;
    tasks: string[];
    createdAt: string;
    updatedAt: string;
}
export interface SoftwareFactoryProgram {
    schemaVersion: typeof SOFTWARE_FACTORY_SCHEMA_VERSION;
    id: string;
    projectId: string;
    name: string;
    objective: string;
    status: SoftwareFactoryProgramStatus;
    workstreams: string[];
    createdAt: string;
    updatedAt: string;
}
export interface SoftwareFactoryTaskAlias {
    schemaVersion: typeof SOFTWARE_FACTORY_SCHEMA_VERSION;
    id: string;
    projectId: string;
    programId: string;
    workstreamId: string;
    taskId: string;
    createdAt: string;
}
export type SoftwareFactoryTaskInput = Omit<TaskDraft, "projectId" | "programId" | "workstreamId">;
export interface ProgramSummary {
    id: string;
    projectId: string;
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
 * Redacted routing verdict for one task. The full \EnvironmentCodeRoute\
 * stays server-side; only this light status crosses the API.
 */
export interface TaskEnvironmentRoutingSummary {
    taskId: string;
    code: string;
    status: "routed" | "requires_provisioning" | "no_environment" | "unsupported" | "skipped";
    detail: string;
}
export interface SoftwareFactoryProgramDetail {
    program: SoftwareFactoryProgram;
    workstreams: readonly Workstream[];
    graph: GraphProjection;
    routes: readonly TaskEnvironmentRoutingSummary[];
}
export interface FileImpact {
    readScopes: string[];
    writeScopes: string[];
    likelyFiles: string[];
    sharedFiles: string[];
}
export interface WriteScopeLease {
    leaseId: string;
    projectId: string;
    taskId: string;
    agentId: string;
    workspaceId: string;
    scope: string[];
    status: "active" | "expired" | "released";
    acquiredAt: string;
    expiresAt: string;
    version: number;
}
export interface ExecutionWave {
    waveId: string;
    projectId: string;
    taskIds: string[];
    dependenciesSatisfied: boolean;
    conflictChecked: boolean;
    createdAt: string;
    version: number;
}
