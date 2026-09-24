/**
 * In-memory `OperatorAccountStore` with exactly the commit semantics of the
 * Firestore adapter (serialized, all-or-nothing). Used by tests and local
 * runs; shared between two service instances it models concurrent servers.
 */
import { AccountConflictError, BootstrapLockedError, LastAdministratorError, isActiveAdmin, validateOperatorAccount, } from "../../contracts/index.js";
export class InMemoryOperatorAccountStore {
    accounts = new Map();
    activeAdmins = 0;
    bootstrapOperatorId;
    lock = Promise.resolve();
    async get(operatorId) {
        const account = this.accounts.get(operatorId);
        return account ? structuredClone(account) : undefined;
    }
    async list() {
        return [...this.accounts.values()].map((a) => structuredClone(a));
    }
    commit(change) {
        const run = this.lock.then(async () => {
            await Promise.resolve();
            return this.apply(change);
        });
        this.lock = run.catch(() => undefined);
        return run;
    }
    apply(change) {
        validateOperatorAccount(change.account);
        const id = change.account.id;
        const current = this.accounts.get(id);
        if (change.kind === "create_pending") {
            if (current)
                return "exists";
            this.accounts.set(id, structuredClone(change.account));
            return "committed";
        }
        if (change.kind === "bootstrap") {
            if (this.bootstrapOperatorId !== undefined) {
                if (this.bootstrapOperatorId === id && isActiveAdmin(current)) {
                    return "already_provisioned";
                }
                throw new BootstrapLockedError();
            }
            if (this.activeAdmins > 0)
                throw new BootstrapLockedError();
            this.accounts.set(id, structuredClone(change.account));
            this.bootstrapOperatorId = id;
            this.activeAdmins += isActiveAdmin(current) ? 0 : 1;
            return "committed";
        }
        if (!current || current.revision !== change.expectedRevision) {
            throw new AccountConflictError();
        }
        const next = this.activeAdmins + change.activeAdminDelta;
        if (change.activeAdminDelta < 0 && next < 1) {
            throw new LastAdministratorError();
        }
        this.accounts.set(id, structuredClone(change.account));
        this.activeAdmins = next;
        return "committed";
    }
}
