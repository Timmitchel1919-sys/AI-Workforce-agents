import { type ExecutionRecordStore, type WorkflowCapabilityContext, type WorkflowDefinition, type WorkflowGraph, type WorkflowSimulation, type WorkflowValidationResult, type WorkflowVersion } from "../../contracts/index.js";
export interface WorkflowDefinitionServiceDeps {
    store: ExecutionRecordStore;
    /** Real registries — read at validation time, never cached. */
    capabilities: (projectId: string) => WorkflowCapabilityContext;
    clock?: () => number;
    newId?: () => string;
}
export interface SaveDraftInput {
    projectId: string;
    /** Omit to create a new definition. */
    definitionId?: string;
    /** Required when updating: the revision the editor started from. */
    expectedRevision?: number;
    name: string;
    description?: string;
    graph: unknown;
}
export declare class WorkflowDefinitionService {
    private readonly store;
    private readonly capabilities;
    private readonly clock;
    private readonly newId;
    constructor(deps: WorkflowDefinitionServiceDeps);
    private iso;
    /** Normalize + authoritative validation. Never persists. */
    validate(projectId: string, graphInput: unknown): {
        graph: WorkflowGraph;
        result: WorkflowValidationResult;
    };
    list(projectId: string): Promise<WorkflowDefinition[]>;
    /** Project-checked read. A definition from another project is NOT FOUND. */
    get(projectId: string, definitionId: string): Promise<WorkflowDefinition | undefined>;
    private require;
    versions(projectId: string, definitionId: string): Promise<WorkflowVersion[]>;
    version(projectId: string, definitionId: string, version: number): Promise<WorkflowVersion | undefined>;
    private write;
    /**
     * Save a draft. A draft MAY be invalid (work in progress); its validation is
     * recorded so the UI shows the server's verdict, and publishing re-checks.
     */
    saveDraft(input: SaveDraftInput, actor: string): Promise<WorkflowDefinition>;
    /** Re-validate the stored draft against the CURRENT registries. */
    validateStored(projectId: string, definitionId: unknown, actor: string): Promise<WorkflowDefinition>;
    /**
     * Publish the current draft as a new IMMUTABLE version. Refused unless the
     * server validates it right now (a stale "valid" flag is never trusted).
     */
    publish(projectId: string, definitionId: unknown, expectedRevision: unknown, actor: string): Promise<{
        definition: WorkflowDefinition;
        version: WorkflowVersion;
    }>;
    archive(projectId: string, definitionId: unknown, actor: string): Promise<WorkflowDefinition>;
    /**
     * Governed rollback: copy a published version into a NEW draft revision.
     * Published versions and their history are never modified or deleted.
     */
    restoreVersion(projectId: string, definitionId: unknown, versionNumber: unknown, actor: string): Promise<WorkflowDefinition>;
    /** Duplicate into a new draft definition in the same project. */
    duplicate(projectId: string, definitionId: unknown, actor: string): Promise<WorkflowDefinition>;
    /**
     * SIMULATION — computes what the existing engine WOULD do, from real
     * registry data. It never calls an agent, model, tool or approval and never
     * creates a task or workflow. Pure read.
     */
    simulate(projectId: string, definitionId: unknown, source: "draft" | number): Promise<WorkflowSimulation>;
    /** Whether the stored draft is VALIDATED at its current revision. */
    static isValidated(def: WorkflowDefinition): boolean;
}
