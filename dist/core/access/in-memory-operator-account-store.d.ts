/**
 * In-memory `OperatorAccountStore` with exactly the commit semantics of the
 * Firestore adapter (serialized, all-or-nothing). Used by tests and local
 * runs; shared between two service instances it models concurrent servers.
 */
import { type OperatorAccount, type OperatorAccountChange, type OperatorAccountCommitResult, type OperatorAccountStore } from "../../contracts/index.js";
export declare class InMemoryOperatorAccountStore implements OperatorAccountStore {
    private readonly accounts;
    private activeAdmins;
    private bootstrapOperatorId;
    private lock;
    get(operatorId: string): Promise<OperatorAccount | undefined>;
    list(): Promise<OperatorAccount[]>;
    commit(change: OperatorAccountChange): Promise<OperatorAccountCommitResult>;
    private apply;
}
