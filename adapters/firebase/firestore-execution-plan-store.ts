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
import {
  PlanRevisionConflictError,
  type ExecutionPlanStore,
  type PlanRevisionChange,
} from "../../contracts/index.js";
import type {
  FirestoreQueryableCollectionLike,
  TransactionalFirestoreLike,
} from "./firebase-services.js";

export const EXECUTION_PLANS_COLLECTION = "execution_plans";
export const EXECUTION_PLAN_HEADS_COLLECTION = "execution_plan_heads";

/** Internal signal: the precondition failed inside the transaction. */
class PreconditionFailed extends Error {}

export class FirestoreExecutionPlanStore implements ExecutionPlanStore {
  private readonly plans: FirestoreQueryableCollectionLike;
  private readonly heads: FirestoreQueryableCollectionLike;

  constructor(
    private readonly firestore: TransactionalFirestoreLike,
    options: { collectionPrefix?: string } = {},
  ) {
    const prefix = options.collectionPrefix ?? "";
    this.plans = firestore.collection(prefix + EXECUTION_PLANS_COLLECTION);
    this.heads = firestore.collection(prefix + EXECUTION_PLAN_HEADS_COLLECTION);
  }

  async commit(change: PlanRevisionChange): Promise<void> {
    const id = String(change.record.id);
    const planId = String(change.record.planId);
    const projectId = String(change.record.projectId);
    const version = Number(change.record.version);
    const planRef = this.plans.doc(id);
    const headRef = this.heads.doc(planId);

    try {
      await this.firestore.runTransaction(async (tx) => {
        // All reads first (a Firestore transaction requirement).
        const head = await tx.get(headRef);
        const headVersion = head.exists
          ? Number(head.data()?.currentVersion)
          : undefined;

        if (change.kind === "create_series") {
          if (head.exists) throw new PreconditionFailed();
          tx.create(planRef, change.record);
          tx.create(headRef, { planId, projectId, currentVersion: version });
          return;
        }

        if (change.kind === "new_revision") {
          const previousRef = this.plans.doc(
            String(change.supersededRecord.id),
          );
          const previous = await tx.get(previousRef);
          const data = previous.data();
          if (
            headVersion !== change.expectedCurrentVersion ||
            version !== change.expectedCurrentVersion + 1 ||
            !previous.exists ||
            data?.updatedAt !== change.expectedPreviousUpdatedAt ||
            data?.status !== change.expectedPreviousStatus
          ) {
            throw new PreconditionFailed();
          }
          tx.create(planRef, change.record);
          tx.set(previousRef, change.supersededRecord);
          tx.set(headRef, { planId, projectId, currentVersion: version });
          return;
        }

        const current = await tx.get(planRef);
        const data = current.data();
        if (
          headVersion !== version ||
          !current.exists ||
          data?.updatedAt !== change.expectedUpdatedAt ||
          data?.status !== change.expectedStatus
        ) {
          throw new PreconditionFailed();
        }
        tx.set(planRef, change.record);
      });
    } catch (error) {
      if (error instanceof PreconditionFailed || isAlreadyExists(error)) {
        throw new PlanRevisionConflictError();
      }
      throw error;
    }
  }

  async listByProject(projectId: string): Promise<unknown[]> {
    const snap = await this.plans.where("projectId", "==", projectId).get();
    return snap.docs.map((doc) => doc.data());
  }

  async listSeries(planId: string): Promise<unknown[]> {
    const snap = await this.plans.where("planId", "==", planId).get();
    return snap.docs.map((doc) => doc.data());
  }
}

/** gRPC ALREADY_EXISTS (6) — a `create` hit an existing document. */
function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}
