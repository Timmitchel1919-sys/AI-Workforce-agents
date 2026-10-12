import type { Repository } from "../../contracts/persistence.js";
import type { SecurityException } from "../../contracts/security-build.js";
/**
 * Persistence store for governed SecurityExceptions.
 *
 * CRITICAL INVARIANTS:
 * - Exceptions MUST be explicit, time-limited, and risk-accepted.
 * - Exceptions CANNOT override confirmed secret leaks or critical system invariants.
 * - Expired exceptions automatically cease to bypass blocking findings.
 */
export declare class SecurityExceptionStore {
    private readonly repository;
    constructor(repository?: Repository<SecurityException>);
    createException(exception: Omit<SecurityException, "createdAt" | "status">): Promise<SecurityException>;
    getException(id: string): Promise<SecurityException | undefined>;
    findActiveExceptionForFinding(findingId: string, environment: string): Promise<SecurityException | undefined>;
    revokeException(id: string): Promise<SecurityException>;
}
