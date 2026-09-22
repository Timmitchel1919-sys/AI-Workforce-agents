import { type Repository, type Workflow, type WorkflowCounters, type WorkflowDraft, type WorkflowResult, type WorkflowStatus, type WorkflowTaskRecord } from "../../contracts/index.js";
export interface WorkflowTransitionPatch {
    error?: string;
    metadata?: Record<string, unknown>;
}
export declare class WorkflowSystem {
    private readonly repo;
    constructor(repo?: Repository<Workflow>);
    create(draft: WorkflowDraft): Workflow;
    get(id: string): Workflow | undefined;
    require(id: string): Workflow;
    list(): Workflow[];
    canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean;
    transition(id: string, to: WorkflowStatus, patch?: WorkflowTransitionPatch): Workflow;
    /** Replace one task record (matched by `specId`) within the workflow. */
    updateTaskRecord(id: string, specId: string, patch: Partial<Omit<WorkflowTaskRecord, "specId">>): Workflow;
    incrementCounter(id: string, key: keyof WorkflowCounters, by?: number): Workflow;
    setResult(id: string, result: WorkflowResult): Workflow;
}
