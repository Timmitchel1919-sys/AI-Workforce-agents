import type { Entity } from "./persistence.js";
export declare const PROGRAM_STATUSES: readonly ["draft", "planning", "ready", "running", "blocked", "replanning", "awaiting_approval", "verifying", "completed", "failed", "cancelled"];
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];
export interface SoftwareFactoryProgram extends Entity {
    projectId: string;
    objective: string;
    architectureRevision: number;
    status: ProgramStatus;
    workstreams: string[];
    taskGraphReference: string;
    createdAt: string;
    updatedAt: string;
    version: number;
    sourceRequestReference?: string;
    policyReference?: string;
}
export declare const WORKSTREAM_STATUSES: readonly ["draft", "ready", "running", "blocked", "completed", "failed", "cancelled"];
export type WorkstreamStatus = (typeof WORKSTREAM_STATUSES)[number];
export interface Workstream extends Entity {
    programId: string;
    projectId: string;
    name: string;
    objective: string;
    status: WorkstreamStatus;
    dependencies: string[];
    tasks: string[];
    requiredCapabilities: string[];
    completionCriteria: string[];
    priority: number;
    createdAt: string;
    updatedAt: string;
}
export type DependencyType = "blocking" | "data" | "artifact" | "verification" | "approval";
export interface TaskDependency {
    taskId: string;
    type: DependencyType;
}
export type GraphNodeType = "project" | "program" | "workstream" | "task" | "agent" | "model" | "environment" | "execution" | "changeset" | "verification" | "approval" | "repository" | "deployment";
export type GraphEdgeType = "contains" | "depends_on" | "assigned_to" | "requires" | "routed_to" | "uses" | "executes" | "produces" | "verifies" | "approves" | "deploys_to";
export interface GraphNode {
    id: string;
    type: GraphNodeType;
    label: string;
    metadata?: Record<string, unknown>;
}
export interface GraphEdge {
    source: string;
    target: string;
    type: GraphEdgeType;
    metadata?: Record<string, unknown>;
}
export interface GraphProjection {
    nodes: GraphNode[];
    edges: GraphEdge[];
    revision: number;
}
