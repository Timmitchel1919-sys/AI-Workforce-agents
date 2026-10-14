import type { ManagedSecretReference } from "./secret-reference.js";
export interface SecretAccessContext {
    principalType: "human" | "agent" | "service" | "system";
    principalId: string;
    projectId?: string;
    environment: "local" | "test" | "staging" | "production";
    purpose: string;
    correlationId: string;
    requestedAt: string;
}
export interface ResolvedSecretLease {
    referenceId: string;
    value: string;
    version?: string;
    resolvedAt: string;
    expiresAt?: string;
    dispose(): void;
}
export interface SecretVaultHealth {
    configured: boolean;
    reachable: boolean;
    provider: string;
    lastSuccessfulAccess?: string;
    lastFailure?: string;
}
export interface SecretVault {
    resolve(reference: ManagedSecretReference, context: SecretAccessContext): Promise<ResolvedSecretLease>;
    createSecret?(reference: ManagedSecretReference, initialValue: string, context: SecretAccessContext): Promise<void>;
    rotate?(reference: ManagedSecretReference, newValue: string, context: SecretAccessContext): Promise<{
        newVersion: string;
    }>;
    revoke?(reference: ManagedSecretReference, context: SecretAccessContext): Promise<void>;
    health?(): Promise<SecretVaultHealth>;
}
export interface CredentialBroker {
    executeWithSecret<T>(context: SecretAccessContext, reference: ManagedSecretReference, fn: (secretValue: string) => Promise<T>): Promise<T>;
}
