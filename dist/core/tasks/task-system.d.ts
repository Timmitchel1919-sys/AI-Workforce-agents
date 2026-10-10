import { type Repository, type Task, type TaskDraft, type TaskStatus } from "../../contracts/index.js";
export interface TransitionPatch {
    assignedAgentId?: string;
    approvalId?: string;
    output?: unknown;
    metadata?: Record<string, unknown>;
    error?: string;
}
export interface TaskSystemOptions {
    newId?: () => string;
}
export declare class TaskSystem {
    private readonly repo;
    private readonly newId;
    constructor(repo?: Repository<Task>, options?: TaskSystemOptions);
    create(draft: TaskDraft): Task;
    get(id: string): Task | undefined;
    require(id: string): Task;
    list(): Task[];
    /** Remove a task outright (used by the software factory for planned-placeholder cleanup). */
    delete(id: string): boolean;
    canTransition(from: TaskStatus, to: TaskStatus): boolean;
    transition(id: string, to: TaskStatus, patch?: TransitionPatch): Task;
    assign(id: string, agentId: string): Task;
    complete(id: string, output: unknown): Task;
    fail(id: string, error: string): Task;
    cancel(id: string): Task;
}
