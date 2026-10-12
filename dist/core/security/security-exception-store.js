import { InMemoryRepository } from "../persistence/in-memory-repository.js";
/**
 * Persistence store for governed SecurityExceptions.
 *
 * CRITICAL INVARIANTS:
 * - Exceptions MUST be explicit, time-limited, and risk-accepted.
 * - Exceptions CANNOT override confirmed secret leaks or critical system invariants.
 * - Expired exceptions automatically cease to bypass blocking findings.
 */
export class SecurityExceptionStore {
    repository;
    constructor(repository = new InMemoryRepository()) {
        this.repository = repository;
    }
    async createException(exception) {
        const now = new Date().toISOString();
        const created = {
            ...exception,
            createdAt: now,
            status: "active",
        };
        await this.repository.upsert(created);
        return created;
    }
    async getException(id) {
        const ex = await this.repository.findById(id);
        if (!ex)
            return undefined;
        // Auto-expire check
        if (ex.status === "active" && new Date(ex.expiresAt).getTime() < Date.now()) {
            const expired = { ...ex, status: "expired" };
            await this.repository.upsert(expired);
            return expired;
        }
        return ex;
    }
    async findActiveExceptionForFinding(findingId, environment) {
        const all = await this.repository.list();
        const nowMs = Date.now();
        return all.find((ex) => ex.findingId === findingId &&
            ex.status === "active" &&
            (ex.environment === "*" || ex.environment === environment) &&
            new Date(ex.expiresAt).getTime() > nowMs);
    }
    async revokeException(id) {
        const existing = await this.getException(id);
        if (!existing) {
            throw new Error(`Security exception '${id}' not found.`);
        }
        const revoked = { ...existing, status: "revoked" };
        await this.repository.upsert(revoked);
        return revoked;
    }
}
