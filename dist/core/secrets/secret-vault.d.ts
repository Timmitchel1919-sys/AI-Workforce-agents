import type { SecretAccessRequest, SecretExposureReport, SecretReference } from "../../contracts/secrets.js";
import type { ZTNSecurityEvent } from "../../contracts/security.js";
import type { Repository } from "../../contracts/persistence.js";
import { SecretPolicyEngine } from "./secret-policy-engine.js";
import { type SecretProvider } from "./secret-provider.js";
import { SecretReferenceStore } from "./secret-reference-store.js";
import { SecretValue } from "./secret-value.js";
export interface SecretVaultOptions {
    referenceStore?: SecretReferenceStore;
    policyEngine?: SecretPolicyEngine;
    providers?: SecretProvider[];
    auditLog?: {
        log(event: string, meta?: Record<string, unknown>): void;
    };
    securityEvents?: Repository<ZTNSecurityEvent>;
    /** In-memory cache TTL in milliseconds. Default 0 (no cache). */
    cacheTtlMs?: number;
}
/**
 * Central Secret Vault Orchestrator.
 * Handles purpose-bound secret resolution, provider routing, policy enforcement,
 * rotation workflows, exposure reporting, and immutable security event auditing.
 */
export declare class SecretVault {
    private readonly store;
    private readonly policyEngine;
    private readonly providers;
    private readonly auditLog?;
    private readonly securityEvents?;
    private readonly cacheTtlMs;
    private readonly cache;
    constructor(options?: SecretVaultOptions);
    registerProvider(provider: SecretProvider): void;
    getStore(): SecretReferenceStore;
    /**
     * Purpose-bound secret execution seam.
     * Resolves secret internally, invokes `fn(secretValue)`, and discards the value.
     * Never returns raw secret value to external callers.
     */
    executeWithSecret<T>(request: SecretAccessRequest, fn: (secret: SecretValue) => Promise<T>): Promise<T>;
    /**
     * Resolves environment object for process spawning with ephemeral secret variable.
     * The secret value is NOT written to logs or audit records.
     */
    getScopedEnvironment(request: SecretAccessRequest, envVarName: string, baseEnv?: Record<string, string | undefined>): Promise<Record<string, string>>;
    /**
     * Internal resolution helper that enforces policy, checks cache, calls provider, and audits metadata.
     */
    private resolveSecretInternal;
    /**
     * Governed Rotation Workflow.
     * Puts new secret version in provider, validates, updates reference version, and disables old version.
     */
    rotateSecret(referenceId: string, newValue: string, actorId: string, correlationId: string, validator?: (secret: SecretValue) => Promise<boolean>): Promise<SecretReference>;
    /**
     * Exposure Response: Reports a suspected/confirmed secret leak, marks status, and raises HIGH/CRITICAL security event.
     */
    reportExposure(report: SecretExposureReport, correlationId: string): Promise<SecretReference>;
    private emitAuditEvent;
}
