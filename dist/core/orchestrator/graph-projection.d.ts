import { WorkforceGraphProjection, GraphQueryOptions } from "../../contracts/graph.js";
import { AgentRegistry, ProjectRegistry, TaskSystem } from "../index.js";
import { SoftwareFactoryOrchestrator } from "./software-factory-orchestrator.js";
export declare class WorkforceGraphProjectionService {
    private readonly projectRegistry;
    private readonly agentRegistry;
    private readonly taskSystem;
    private readonly sfOrchestrator;
    private revision;
    constructor(projectRegistry: ProjectRegistry, agentRegistry: AgentRegistry, taskSystem: TaskSystem, sfOrchestrator: SoftwareFactoryOrchestrator);
    getProjection(options: GraphQueryOptions): WorkforceGraphProjection;
}
