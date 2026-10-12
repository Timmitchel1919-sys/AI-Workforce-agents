import crypto from "node:crypto";
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  operatorCan,
  operatorCanAccessProject,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import type {
  SimulationDomain,
  SimulationInput,
  SimulationOption,
  SimulationResult,
  SimulationSnapshot,
} from "../../contracts/simulation.js";
import type { Repository } from "../../contracts/persistence.js";
import { createId, now } from "../../core/index.js";
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

export class SimulationControlService {
  private readonly engine: SimulationEngine;

  constructor(
    private readonly snapshots: Repository<SimulationSnapshot>,
    private readonly audit?: AuditLog,
    engine?: SimulationEngine,
  ) {
    this.engine = engine ?? new SimulationEngine();
  }

  private requireReader(principal: OperatorPrincipal): void {
    if (!operatorCan(principal, "view")) {
      throw new PermissionDeniedError("insufficient capabilities to access simulation");
    }
  }

  private requireOperator(principal: OperatorPrincipal): void {
    if (principal.role !== "admin" && principal.role !== "operator") {
      throw new PermissionDeniedError("requires operator or admin role to run simulations");
    }
  }

  private requireProjectAccess(principal: OperatorPrincipal, projectId?: string): void {
    if (projectId && !operatorCanAccessProject(principal, projectId)) {
      throw new PermissionDeniedError("no access to the requested project");
    }
  }

  /**
   * Executes a pure what-if simulation, computes the decision matrix, and saves an immutable snapshot.
   * NEVER modifies production configurations or state.
   */
  runSimulation(
    principal: OperatorPrincipal,
    request: CreateSimulationRequest,
  ): SimulationSnapshot {
    this.requireOperator(principal);
    this.requireProjectAccess(principal, request.projectId);

    if (!request.title || request.title.trim().length === 0) {
      throw new ValidationError("simulation title is required");
    }

    const simulationId = createId("sim");
    const snapshotId = createId("snap");
    const timestamp = now();

    const input: SimulationInput = {
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

    const result: SimulationResult = this.engine.simulate(input);

    const initialStateHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ input, timestamp }))
      .digest("hex");

    const snapshot: SimulationSnapshot = {
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
  listSnapshots(
    principal: OperatorPrincipal,
    projectId?: string,
  ): SimulationSnapshot[] {
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
  getSnapshot(
    principal: OperatorPrincipal,
    snapshotId: string,
  ): SimulationSnapshot | undefined {
    this.requireReader(principal);
    const snap = this.snapshots.findById(snapshotId);
    if (!snap) return undefined;
    if (snap.projectId && !operatorCanAccessProject(principal, snap.projectId)) {
      return undefined;
    }
    return snap;
  }

  /**
   * Records a human operator's decision on a simulation snapshot.
   */
  decideOption(
    principal: OperatorPrincipal,
    snapshotId: string,
    optionId: string,
    notes?: string,
  ): SimulationSnapshot {
    this.requireOperator(principal);
    const snap = this.getSnapshot(principal, snapshotId);
    if (!snap) throw new NotFoundError("simulation snapshot not found");

    const optionExists = snap.result.decisionMatrix.options.some((o) => o.optionId === optionId);
    if (!optionExists) {
      throw new ValidationError(`optionId "${optionId}" does not exist in this simulation matrix`);
    }

    const updated: SimulationSnapshot = {
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
