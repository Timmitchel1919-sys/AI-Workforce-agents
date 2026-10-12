import type { Repository } from "../../contracts/persistence.js";
import type { SecurityException } from "../../contracts/security-build.js";
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
  constructor(
    private readonly repository: Repository<SecurityException> = new InMemoryRepository<SecurityException>()
  ) {}

  async createException(
    exception: Omit<SecurityException, "createdAt" | "status">
  ): Promise<SecurityException> {
    const now = new Date().toISOString();
    const created: SecurityException = {
      ...exception,
      createdAt: now,
      status: "active",
    };
    await this.repository.upsert(created);
    return created;
  }

  async getException(id: string): Promise<SecurityException | undefined> {
    const ex = await this.repository.findById(id);
    if (!ex) return undefined;

    // Auto-expire check
    if (ex.status === "active" && new Date(ex.expiresAt).getTime() < Date.now()) {
      const expired: SecurityException = { ...ex, status: "expired" };
      await this.repository.upsert(expired);
      return expired;
    }
    return ex;
  }

  async findActiveExceptionForFinding(
    findingId: string,
    environment: string
  ): Promise<SecurityException | undefined> {
    const all = await this.repository.list();
    const nowMs = Date.now();

    return all.find(
      (ex) =>
        ex.findingId === findingId &&
        ex.status === "active" &&
        (ex.environment === "*" || ex.environment === environment) &&
        new Date(ex.expiresAt).getTime() > nowMs
    );
  }

  async revokeException(id: string): Promise<SecurityException> {
    const existing = await this.getException(id);
    if (!existing) {
      throw new Error(`Security exception '${id}' not found.`);
    }
    const revoked: SecurityException = { ...existing, status: "revoked" };
    await this.repository.upsert(revoked);
    return revoked;
  }
}
