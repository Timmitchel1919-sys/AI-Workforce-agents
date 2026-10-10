/**
 * Firestore implementation of the planning `ExecutionPlanStore` port (EO-3.2).
 *
 *   execution_plans/{planId@vN}      one immutable-content document per version
 *   execution_plan_heads/{planId}    { planId, projectId, currentVersion }
 *
 * Every commit runs in a Firestore TRANSACTION that re-reads the series head
 * (and the affected version) and checks the optimistic precondition before
 * writing. Firestore retries/aborts conflicting transactions, so two
 * instances replanning the same series can never both win: the loser gets a
 * `PlanRevisionConflictError` and nothing is written. New versions use
 * `create`, which fails if the document exists — a version is never
 * overwritten.
 *
 * Reads are single-field equality queries (`projectId ==`, `planId ==`),
 * served by Firestore's automatic indexes — no composite index is required.
 * Only the Control Plane (Admin SDK) touches these collections; client rules
 * stay deny-all.
 */
import { type ExecutionPlanStore, type PlanRevisionChange } from "../../contracts/index.js";
import type { TransactionalFirestoreLike } from "./firebase-services.js";
export declare const EXECUTION_PLANS_COLLECTION = "execution_plans";
export declare const EXECUTION_PLAN_HEADS_COLLECTION = "execution_plan_heads";
export declare class FirestoreExecutionPlanStore implements ExecutionPlanStore {
    private readonly firestore;
    private readonly plans;
    private readonly heads;
    constructor(firestore: TransactionalFirestoreLike, options?: {
        collectionPrefix?: string;
    });
    commit(change: PlanRevisionChange): Promise<void>;
    listByProject(projectId: string): Promise<unknown[]>;
    listSeries(planId: string): Promise<unknown[]>;
}
