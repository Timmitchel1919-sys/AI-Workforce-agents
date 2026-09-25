import { type GraphProjection, type Repository, type SoftwareFactoryEnvironmentProvider, type SoftwareFactoryOverview, type SoftwareFactoryProgram, type SoftwareFactoryProgramDetail, type SoftwareFactoryTaskAlias, type SoftwareFactoryTaskInput, type Task, type TaskDraft, type Workstream } from "../../contracts/index.js";
import type { TaskSystem } from "../tasks/task-system.js";
import type { Orchestrator } from "./orchestrator.js";
export interface SoftwareFactoryPersistence {
    programs: Repository<SoftwareFactoryProgram>;
    workstreams: Repository<Workstream>;
    executionAliases: Repository<SoftwareFactoryTaskAlias>;
}
export interface SoftwareFactoryOrchestratorOptions {
    persistence?: SoftwareFactoryPersistence;
    projectExists?: (projectId: string) => boolean;
}
export declare class SoftwareFactoryOrchestrator {
    private readonly orchestrator;
    private readonly taskSystem;
    private readonly environments;
    private readonly programs;
    private readonly workstreams;
    private readonly executionAliases;
    private readonly projectExists;
    private readonly ticks;
    constructor(orchestrator: Orchestrator, taskSystem: TaskSystem, environments: SoftwareFactoryEnvironmentProvider, options?: SoftwareFactoryOrchestratorOptions);
    createProgram(id: string, name: string, objective: string, projectId?: string): SoftwareFactoryProgram;
    createWorkstream(programId: string, id: string, name: string, objective: string, projectId?: string): Workstream;
    addTask(workstreamId: string, input: SoftwareFactoryTaskInput | TaskDraft): Task;
    findProgram(programId: string, projectId?: string): SoftwareFactoryProgram | undefined;
    findWorkstream(workstreamId: string, programId?: string, projectId?: string): Workstream | undefined;
    tick(programId?: string): Promise<void>;
    private tickProgram;
    overview(projectIds?: ReadonlySet<string>): SoftwareFactoryOverview;
    programDetail(programId: string, projectId?: string): SoftwareFactoryProgramDetail | undefined;
    getGraphProjection(programId: string, projectId?: string): GraphProjection;
    private requireProgram;
    private requireWorkstream;
    private programWorkstreams;
    private graphFor;
    private routesFor;
    private dependenciesMet;
    private routeFor;
    private resolveExecution;
    private toSubmitDraft;
    private resolveTaskId;
    private requireTaskOwnership;
    private validateState;
}
