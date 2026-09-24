/**
 * Firestore implementation of `OperatorAccountStore` (AUTHZ-1).
 *
 *   operators/{firebaseUid}        the authoritative operator account
 *   access_control/summary         { activeAdmins }  — atomic admin count
 *   access_control/bootstrap       { operatorId, completedAt } — one-time lock
 *
 * Every mutation runs in a Firestore transaction: the account revision must
 * still match (two administrators approving the same person cannot both win),
 * the admin count is adjusted in the same transaction (the last active
 * administrator cannot be removed, even by two concurrent requests), and the
 * bootstrap lock is created exactly once. Only the Control Plane (Admin SDK)
 * writes here; client Firestore rules stay deny-all.
 */
import {
  AccountConflictError,
  BootstrapLockedError,
  LastAdministratorError,
  isActiveAdmin,
  validateOperatorAccount,
  type OperatorAccount,
  type OperatorAccountChange,
  type OperatorAccountCommitResult,
  type OperatorAccountStore,
} from "../../contracts/index.js";
import type {
  FirestoreCollectionLike,
  TransactionalFirestoreLike,
} from "./firebase-services.js";

export const OPERATORS_COLLECTION = "operators";
export const ACCESS_CONTROL_COLLECTION = "access_control";

function plain(account: OperatorAccount): Record<string, unknown> {
  return JSON.parse(JSON.stringify(account)) as Record<string, unknown>;
}

function toAccount(data: Record<string, unknown> | undefined) {
  if (!data) return undefined;
  const account = structuredClone(data) as unknown as OperatorAccount;
  try {
    validateOperatorAccount(account);
  } catch {
    // Fail closed: a malformed record authorizes nothing.
    return undefined;
  }
  return account;
}

export class FirestoreOperatorAccountStore implements OperatorAccountStore {
  private readonly operators: FirestoreCollectionLike;
  private readonly control: FirestoreCollectionLike;

  constructor(
    private readonly firestore: TransactionalFirestoreLike,
    options: { collectionPrefix?: string } = {},
  ) {
    const prefix = options.collectionPrefix ?? "";
    this.operators = firestore.collection(prefix + OPERATORS_COLLECTION);
    this.control = firestore.collection(prefix + ACCESS_CONTROL_COLLECTION);
  }

  async get(operatorId: string): Promise<OperatorAccount | undefined> {
    const snap = await this.operators.doc(operatorId).get();
    return snap.exists ? toAccount(snap.data()) : undefined;
  }

  async list(): Promise<OperatorAccount[]> {
    const snap = await this.operators.get();
    return snap.docs
      .map((doc) => toAccount(doc.data()))
      .filter((a): a is OperatorAccount => a !== undefined);
  }

  async commit(
    change: OperatorAccountChange,
  ): Promise<OperatorAccountCommitResult> {
    validateOperatorAccount(change.account);
    const id = change.account.id;
    const accountRef = this.operators.doc(id);
    const summaryRef = this.control.doc("summary");
    const lockRef = this.control.doc("bootstrap");

    return this.firestore.runTransaction(async (tx) => {
      // Reads first (a Firestore transaction requirement).
      const snap = await tx.get(accountRef);
      const current = snap.exists ? toAccount(snap.data()) : undefined;

      if (change.kind === "create_pending") {
        if (snap.exists) return "exists";
        tx.create(accountRef, plain(change.account));
        return "committed";
      }

      const summary = await tx.get(summaryRef);
      const activeAdmins = Number(summary.data()?.activeAdmins ?? 0);

      if (change.kind === "bootstrap") {
        const lock = await tx.get(lockRef);
        if (lock.exists) {
          if (lock.data()?.operatorId === id && isActiveAdmin(current)) {
            return "already_provisioned";
          }
          throw new BootstrapLockedError();
        }
        if (activeAdmins > 0) throw new BootstrapLockedError();
        tx.set(accountRef, plain(change.account));
        tx.create(lockRef, {
          operatorId: id,
          completedAt: change.account.updatedAt,
        });
        tx.set(summaryRef, { activeAdmins: activeAdmins + 1 });
        return "committed";
      }

      if (!current || current.revision !== change.expectedRevision) {
        throw new AccountConflictError();
      }
      const next = activeAdmins + change.activeAdminDelta;
      if (change.activeAdminDelta < 0 && next < 1) {
        throw new LastAdministratorError();
      }
      tx.set(accountRef, plain(change.account));
      if (change.activeAdminDelta !== 0) {
        tx.set(summaryRef, { activeAdmins: next });
      }
      return "committed";
    });
  }
}
