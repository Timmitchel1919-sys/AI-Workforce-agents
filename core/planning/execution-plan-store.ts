/**
 * In-memory `ExecutionPlanStore` (EO-3.2). The port itself lives in
 * `contracts/planning.ts`.
 *
 * Every plan mutation is committed ATOMICALLY with an optimistic
 * precondition, so concurrent writers (two Cloud Functions instances, two
 * operators replanning at once) can never produce duplicate version numbers,
 * two current revisions, or an overwritten history:
 *
 *   create_series  the series head must not exist yet
 *   new_revision   the head must still point at `expectedCurrentVersion`, and
 *                  the previous revision must still be in the observed state
 *   transition     the version must still be current and unchanged since read
 *
 * A failed precondition rejects with `PlanRevisionConflictError` (HTTP 409);
 * nothing is written. Adapters (Firestore) implement this with transactions;
 * the domain never sees a database type. Records are serialized plain JSON.
 */
import {
  PlanRevisionConflictError,
  type ExecutionPlanRecord,
  type ExecutionPlanStore,
  type PlanRevisionChange,
} from "../../contracts/index.js";

interface Head {
  planId: string;
  currentVersion: number;
}

function field(record: ExecutionPlanRecord, key: string): unknown {
  return record[key];
}

/**
 * Reference implementation with the exact commit semantics of the Firestore
 * adapter. Used by default (tests, local runs); shared between two service
 * instances it models two processes racing on one database.
 */
export class InMemoryExecutionPlanStore implements ExecutionPlanStore {
  private readonly records = new Map<string, ExecutionPlanRecord>();
  private readonly heads = new Map<string, Head>();

  async commit(change: PlanRevisionChange): Promise<void> {
    // Yield first so concurrent callers genuinely interleave.
    await Promise.resolve();
    const id = String(field(change.record, "id"));
    const planId = String(field(change.record, "planId"));
    const version = Number(field(change.record, "version"));

    if (change.kind === "create_series") {
      if (this.heads.has(planId) || this.records.has(id)) {
        throw new PlanRevisionConflictError("execution plan already exists");
      }
      this.records.set(id, structuredClone(change.record));
      this.heads.set(planId, { planId, currentVersion: version });
      return;
    }

    const head = this.heads.get(planId);
    if (change.kind === "new_revision") {
      const previousId = String(field(change.supersededRecord, "id"));
      const previous = this.records.get(previousId);
      if (
        !head ||
        head.currentVersion !== change.expectedCurrentVersion ||
        version !== change.expectedCurrentVersion + 1 ||
        this.records.has(id) ||
        !previous ||
        field(previous, "updatedAt") !== change.expectedPreviousUpdatedAt ||
        field(previous, "status") !== change.expectedPreviousStatus
      ) {
        throw new PlanRevisionConflictError();
      }
      this.records.set(id, structuredClone(change.record));
      this.records.set(previousId, structuredClone(change.supersededRecord));
      this.heads.set(planId, { planId, currentVersion: version });
      return;
    }

    const current = this.records.get(id);
    if (
      !head ||
      head.currentVersion !== version ||
      !current ||
      field(current, "updatedAt") !== change.expectedUpdatedAt ||
      field(current, "status") !== change.expectedStatus
    ) {
      throw new PlanRevisionConflictError();
    }
    this.records.set(id, structuredClone(change.record));
  }

  async listByProject(projectId: string): Promise<unknown[]> {
    return [...this.records.values()]
      .filter((r) => field(r, "projectId") === projectId)
      .map((r) => structuredClone(r));
  }

  async listSeries(planId: string): Promise<unknown[]> {
    return [...this.records.values()]
      .filter((r) => field(r, "planId") === planId)
      .map((r) => structuredClone(r));
  }

  /** Test seam: overwrite a stored record verbatim (e.g. to corrupt it). */
  unsafePut(record: ExecutionPlanRecord): void {
    this.records.set(String(field(record, "id")), structuredClone(record));
  }
}
