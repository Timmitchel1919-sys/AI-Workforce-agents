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
import { type ExecutionPlanRecord, type ExecutionPlanStore, type PlanRevisionChange } from "../../contracts/index.js";
/**
 * Reference implementation with the exact commit semantics of the Firestore
 * adapter. Used by default (tests, local runs); shared between two service
 * instances it models two processes racing on one database.
 */
export declare class InMemoryExecutionPlanStore implements ExecutionPlanStore {
    private readonly records;
    private readonly heads;
    commit(change: PlanRevisionChange): Promise<void>;
    listByProject(projectId: string): Promise<unknown[]>;
    listSeries(planId: string): Promise<unknown[]>;
    /** Test seam: overwrite a stored record verbatim (e.g. to corrupt it). */
    unsafePut(record: ExecutionPlanRecord): void;
}
