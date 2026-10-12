import { type OperatorPrincipal } from "../../contracts/index.js";
import type { SimulationDomain, SimulationOption, SimulationSnapshot } from "../../contracts/simulation.js";
import type { Repository } from "../../contracts/persistence.js";
import type { AuditLog } from "../../core/index.js";
import { SimulationEngine } from "../../core/simulation/simulation-engine.js";
export interface CreateSimulationRequest {
    title: string;
    description: string;
    domain: SimulationDomain;
    projectId?: string;
    proposedChange: Record<string, unknown>;
    constraints?: Record<string, unknown>;
    assumptions: readonly string[];
    options?: readonly SimulationOption[];
}
export declare class SimulationControlService {
    private readonly snapshots;
    private readonly audit?;
    private readonly engine;
    constructor(snapshots: Repository<SimulationSnapshot>, audit?: AuditLog | undefined, engine?: SimulationEngine);
    private requireReader;
    private requireOperator;
    private requireProjectAccess;
    /**
     * Executes a pure what-if simulation, computes the decision matrix, and saves an immutable snapshot.
     * NEVER modifies production configurations or state.
     */
    runSimulation(principal: OperatorPrincipal, request: CreateSimulationRequest): SimulationSnapshot;
    /**
     * Lists historical simulation snapshots, enforcing project scoping.
     */
    listSnapshots(principal: OperatorPrincipal, projectId?: string): SimulationSnapshot[];
    /**
     * Retrieves a specific snapshot by ID.
     */
    getSnapshot(principal: OperatorPrincipal, snapshotId: string): SimulationSnapshot | undefined;
    /**
     * Records a human operator's decision on a simulation snapshot.
     */
    decideOption(principal: OperatorPrincipal, snapshotId: string, optionId: string, notes?: string): SimulationSnapshot;
}
