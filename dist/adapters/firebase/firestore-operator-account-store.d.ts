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
import { type OperatorAccount, type OperatorAccountChange, type OperatorAccountCommitResult, type OperatorAccountStore } from "../../contracts/index.js";
import type { TransactionalFirestoreLike } from "./firebase-services.js";
export declare const OPERATORS_COLLECTION = "operators";
export declare const ACCESS_CONTROL_COLLECTION = "access_control";
export declare class FirestoreOperatorAccountStore implements OperatorAccountStore {
    private readonly firestore;
    private readonly operators;
    private readonly control;
    constructor(firestore: TransactionalFirestoreLike, options?: {
        collectionPrefix?: string;
    });
    get(operatorId: string): Promise<OperatorAccount | undefined>;
    list(): Promise<OperatorAccount[]>;
    commit(change: OperatorAccountChange): Promise<OperatorAccountCommitResult>;
}
