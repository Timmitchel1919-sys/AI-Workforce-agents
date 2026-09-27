import { Agent } from "./index.js";
export type AgentLifecycleStatus = "provisioning" | "idle" | "running" | "suspended" | "errored" | "terminated";
export interface AgentDescriptor extends Agent {
    role: string;
    department: string;
    avatarUrl?: string;
    costPerHour?: number;
}
export interface AgentInstance {
    id: string;
    descriptorId: string;
    status: AgentLifecycleStatus;
    projectId?: string;
    currentTaskId?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
}
export interface SpecialistTask {
    objective: string;
    context: string[];
    instructions: string;
    acceptanceCriteria: string[];
}
export interface SpecialistResult {
    taskId: string;
    agentId: string;
    summary: string;
    output: Record<string, unknown>;
    createdAt: string;
}
export declare function validateSpecialistTask(raw: unknown): SpecialistTask;
export declare function validateSpecialistResult(raw: unknown): asserts raw is SpecialistResult;
export declare const V1_SPECIALIST_WORKFORCE: AgentDescriptor[];
