import crypto from "node:crypto";
import { NotFoundError, PermissionDeniedError, ValidationError, operatorCan, operatorCanAccessProject, } from "../../contracts/index.js";
import { createId, now } from "../../core/index.js";
import { SimulationEngine } from "../../core/simulation/simulation-engine.js";
export class SimulationControlService {
    snapshots;
    audit;
    engine;
    constructor(snapshots, audit, engine) {
        this.snapshots = snapshots;
        this.audit = audit;
        this.engine = engine ?? new SimulationEngine();
    }
    requireReader(principal) {
        if (!operatorCan(principal, "view")) {
            throw new PermissionDeniedError("insufficient capabilities to access simulation");
        }
    }
    requireOperator(principal) {
        if (principal.role !== "admin" && principal.role !== "operator") {
            throw new PermissionDeniedError("requires operator or admin role to run simulations");
        }
    }
    requireProjectAccess(principal, projectId) {
        if (projectId && !operatorCanAccessProject(principal, projectId)) {
            throw new PermissionDeniedError("no access to the requested project");
        }
    }
    /**
     * Executes a pure what-if simulation, computes the decision matrix, and saves an immutable snapshot.
     * NEVER modifies production configurations or state.
     */
    runSimulation(principal, request) {
        this.requireOperator(principal);
        this.requireProjectAccess(principal, request.projectId);
        if (!request.title || request.title.trim().length === 0) {
            throw new ValidationError("simulation title is required");
        }
        const simulationId = createId("sim");
        const snapshotId = createId("snap");
        const timestamp = now();
        const input = {
            simulationId,
            title: request.title.trim(),
            description: request.description.trim(),
            domain: request.domain,
            projectId: request.projectId,
            proposedChange: request.proposedChange,
            constraints: request.constraints,
            assumptions: request.assumptions,
            options: request.options,
            createdBy: principal.id,
        };
        const result = this.engine.simulate(input);
        const initialStateHash = crypto
            .createHash("sha256")
            .update(JSON.stringify({ input, timestamp }))
            .digest("hex");
        const snapshot = {
            id: snapshotId,
            snapshotId,
            simulationId,
            title: input.title,
            domain: input.domain,
            projectId: input.projectId,
            timestamp,
            initialStateHash,
            input,
            result,
        };
        this.snapshots.upsert(snapshot);
        this.audit?.record("simulation_executed", {
            projectId: input.projectId,
            data: {
                simulationId,
                snapshotId,
                domain: input.domain,
                recommendedOptionId: result.recommendedOptionId,
                dryRunVerified: result.dryRunSafetyVerified,
            },
        });
        return snapshot;
    }
    /**
     * Lists historical simulation snapshots, enforcing project scoping.
     */
    listSnapshots(principal, projectId) {
        this.requireReader(principal);
        this.requireProjectAccess(principal, projectId);
        return this.snapshots
            .list()
            .filter((snap) => {
            if (snap.projectId && !operatorCanAccessProject(principal, snap.projectId)) {
                return false;
            }
            if (projectId && snap.projectId !== projectId) {
                return false;
            }
            return true;
        })
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }
    /**
     * Retrieves a specific snapshot by ID.
     */
    getSnapshot(principal, snapshotId) {
        this.requireReader(principal);
        const snap = this.snapshots.findById(snapshotId);
        if (!snap)
            return undefined;
        if (snap.projectId && !operatorCanAccessProject(principal, snap.projectId)) {
            return undefined;
        }
        return snap;
    }
    /**
     * Records a human operator's decision on a simulation snapshot.
     */
    decideOption(principal, snapshotId, optionId, notes) {
        this.requireOperator(principal);
        const snap = this.getSnapshot(principal, snapshotId);
        if (!snap)
            throw new NotFoundError("simulation snapshot not found");
        const optionExists = snap.result.decisionMatrix.options.some((o) => o.optionId === optionId);
        if (!optionExists) {
            throw new ValidationError(`optionId "${optionId}" does not exist in this simulation matrix`);
        }
        const updated = {
            ...snap,
            decidedOptionId: optionId,
            decidedAt: now(),
            decidedBy: principal.id,
        };
        this.snapshots.upsert(updated);
        this.audit?.record("simulation_decision_recorded", {
            projectId: snap.projectId,
            data: { snapshotId, decidedOptionId: optionId, notes },
        });
        return updated;
    }
}
