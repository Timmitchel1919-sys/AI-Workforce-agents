import type { ManagedSecretReference, ResolvedSecretLease, SecretAccessContext, SecretVault, SecretVaultHealth } from "../../contracts/index.js";
/**
 * In-memory SecretVault implementation for deterministic testing,
 * local execution, and development mocking.
 */
export declare class InMemorySecretVault implements SecretVault {
    private readonly secrets;
    private healthy;
    private lastAccess?;
    private lastError?;
    constructor(initialSecrets?: Record<string, string>);
    setSecret(id: string, value: string, version?: string): void;
    resolve(reference: ManagedSecretReference, _context: SecretAccessContext): Promise<ResolvedSecretLease>;
    createSecret(reference: ManagedSecretReference, initialValue: string, _context: SecretAccessContext): Promise<void>;
    rotate(reference: ManagedSecretReference, newValue: string, _context: SecretAccessContext): Promise<{
        newVersion: string;
    }>;
    revoke(reference: ManagedSecretReference, _context: SecretAccessContext): Promise<void>;
    health(): Promise<SecretVaultHealth>;
    setHealthy(healthy: boolean): void;
}
