import type {
  SecretAccessDecision,
  SecretAccessRequest,
  SecretExposureReport,
  SecretReference,
  SecretRotationPolicy,
} from "../../contracts/secrets.js";
import type { ZTNSecurityEvent } from "../../contracts/security.js";
import type { Repository } from "../../contracts/persistence.js";
import { SecretPolicyEngine } from "./secret-policy-engine.js";
import { type SecretProvider, SecretNotFoundError, SecretVaultError } from "./secret-provider.js";
import { SecretReferenceStore } from "./secret-reference-store.js";
import { SecretValue } from "./secret-value.js";

export interface SecretVaultOptions {
  referenceStore?: SecretReferenceStore;
  policyEngine?: SecretPolicyEngine;
  providers?: SecretProvider[];
  auditLog?: { log(event: string, meta?: Record<string, unknown>): void };
  securityEvents?: Repository<ZTNSecurityEvent>;
  /** In-memory cache TTL in milliseconds. Default 0 (no cache). */
  cacheTtlMs?: number;
}

/**
 * Central Secret Vault Orchestrator.
 * Handles purpose-bound secret resolution, provider routing, policy enforcement,
 * rotation workflows, exposure reporting, and immutable security event auditing.
 */
export class SecretVault {
  private readonly store: SecretReferenceStore;
  private readonly policyEngine: SecretPolicyEngine;
  private readonly providers = new Map<string, SecretProvider>();
  private readonly auditLog?: { log(event: string, meta?: Record<string, unknown>): void };
  private readonly securityEvents?: Repository<ZTNSecurityEvent>;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { value: SecretValue; expiresAt: number }>();

  constructor(options: SecretVaultOptions = {}) {
    this.store = options.referenceStore ?? new SecretReferenceStore();
    this.policyEngine = options.policyEngine ?? new SecretPolicyEngine();
    this.auditLog = options.auditLog;
    this.securityEvents = options.securityEvents;
    this.cacheTtlMs = options.cacheTtlMs ?? 0;

    if (options.providers) {
      for (const p of options.providers) {
        this.registerProvider(p);
      }
    }
  }

  registerProvider(provider: SecretProvider): void {
    this.providers.set(provider.name, provider);
  }

  getStore(): SecretReferenceStore {
    return this.store;
  }

  /**
   * Purpose-bound secret execution seam.
   * Resolves secret internally, invokes `fn(secretValue)`, and discards the value.
   * Never returns raw secret value to external callers.
   */
  async executeWithSecret<T>(
    request: SecretAccessRequest,
    fn: (secret: SecretValue) => Promise<T>
  ): Promise<T> {
    const { secret, reference, decision } = await this.resolveSecretInternal(request);
    try {
      return await fn(secret);
    } finally {
      // SecretValue is non-serializable and non-enumerable
    }
  }

  /**
   * Resolves environment object for process spawning with ephemeral secret variable.
   * The secret value is NOT written to logs or audit records.
   */
  async getScopedEnvironment(
    request: SecretAccessRequest,
    envVarName: string,
    baseEnv: Record<string, string | undefined> = {}
  ): Promise<Record<string, string>> {
    const { secret } = await this.resolveSecretInternal(request);
    const cleanEnv: Record<string, string> = {};

    for (const [k, v] of Object.entries(baseEnv)) {
      if (v !== undefined) cleanEnv[k] = v;
    }
    cleanEnv[envVarName] = secret.reveal();
    return cleanEnv;
  }

  /**
   * Internal resolution helper that enforces policy, checks cache, calls provider, and audits metadata.
   */
  private async resolveSecretInternal(request: SecretAccessRequest): Promise<{
    secret: SecretValue;
    reference: SecretReference;
    decision: SecretAccessDecision;
  }> {
    const reference = await this.store.getReference(request.referenceId);
    if (!reference) {
      this.emitAuditEvent("secret_access_denied", {
        referenceId: request.referenceId,
        actorId: request.actorId,
        purpose: request.purpose,
        reason: "reference_not_found",
        correlationId: request.correlationId,
      });
      throw new SecretNotFoundError(request.referenceId);
    }

    // Evaluate Policy
    const decision = this.policyEngine.evaluate({ request, reference });
    if (!decision.allowed) {
      this.emitAuditEvent("secret_access_denied", {
        referenceId: reference.id,
        kind: reference.kind,
        actorId: request.actorId,
        actorType: request.actorType,
        projectId: reference.projectId,
        environment: reference.environment,
        purpose: request.purpose,
        reason: decision.reason,
        provider: reference.provider,
        correlationId: request.correlationId,
      });
      throw new SecretVaultError("secret_access_policy_denied", `Secret access denied for reference '${reference.id}': ${decision.reason}`);
    }

    // Check Cache
    const cacheKey = `${reference.id}:${reference.version ?? "latest"}`;
    if (this.cacheTtlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.emitAuditEvent("secret_access_allowed", {
          referenceId: reference.id,
          kind: reference.kind,
          actorId: request.actorId,
          projectId: reference.projectId,
          purpose: request.purpose,
          provider: reference.provider,
          cached: true,
          correlationId: request.correlationId,
        });
        return { secret: cached.value, reference, decision };
      }
    }

    // Resolve from Provider
    const provider = this.providers.get(reference.provider);
    if (!provider) {
      this.emitAuditEvent("secret_access_denied", {
        referenceId: reference.id,
        actorId: request.actorId,
        purpose: request.purpose,
        reason: "provider_not_registered",
        provider: reference.provider,
        correlationId: request.correlationId,
      });
      throw new SecretVaultError("provider_not_registered", `Secret provider '${reference.provider}' is not registered in this SecretVault.`);
    }

    const secret = await provider.getSecret(reference);

    if (this.cacheTtlMs > 0) {
      this.cache.set(cacheKey, { value: secret, expiresAt: Date.now() + this.cacheTtlMs });
    }

    this.emitAuditEvent("secret_access_allowed", {
      referenceId: reference.id,
      kind: reference.kind,
      actorId: request.actorId,
      actorType: request.actorType,
      projectId: reference.projectId,
      environment: reference.environment,
      purpose: request.purpose,
      provider: reference.provider,
      version: secret.version ?? reference.version,
      correlationId: request.correlationId,
    });

    return { secret, reference, decision };
  }

  /**
   * Governed Rotation Workflow.
   * Puts new secret version in provider, validates, updates reference version, and disables old version.
   */
  async rotateSecret(
    referenceId: string,
    newValue: string,
    actorId: string,
    correlationId: string,
    validator?: (secret: SecretValue) => Promise<boolean>
  ): Promise<SecretReference> {
    const reference = await this.store.getReference(referenceId);
    if (!reference) throw new SecretNotFoundError(referenceId);

    const provider = this.providers.get(reference.provider);
    if (!provider || !provider.rotateSecret) {
      throw new SecretVaultError("rotation_unsupported", `Provider '${reference.provider}' does not support automated rotation.`);
    }

    this.emitAuditEvent("secret_rotation_requested", {
      referenceId: reference.id,
      actorId,
      provider: reference.provider,
      correlationId,
    });

    this.emitAuditEvent("secret_rotation_started", {
      referenceId: reference.id,
      actorId,
      provider: reference.provider,
      correlationId,
    });

    try {
      // 1. Put new secret version in provider
      const updatedRef = await provider.rotateSecret(reference, newValue);
      const newVersion = updatedRef.version ?? "latest";

      // 2. Validate new credential if validator supplied
      if (validator) {
        const testVal = new SecretValue(newValue, { version: newVersion });
        const isValid = await validator(testVal);
        if (!isValid) {
          this.emitAuditEvent("secret_rotation_failed", {
            referenceId: reference.id,
            actorId,
            reason: "new_credential_validation_failed",
            correlationId,
          });
          throw new SecretVaultError("rotation_validation_failed", `Validation of new credential for secret reference '${reference.id}' failed. Old credential remains active.`);
        }
      }

      // 3. Disable old version if supported
      if (reference.version && provider.disableVersion) {
        try {
          await provider.disableVersion(reference, reference.version);
          this.emitAuditEvent("secret_version_disabled", {
            referenceId: reference.id,
            disabledVersion: reference.version,
            correlationId,
          });
        } catch {
          // Failure to disable old version does not fail the rotation
        }
      }

      // 4. Commit updated reference metadata
      const now = new Date().toISOString();
      const committed = await this.store.updateReference(reference.id, {
        version: newVersion,
        status: "active",
        lastRotatedAt: now,
      });

      // Clear cache
      this.cache.clear();

      this.emitAuditEvent("secret_rotation_succeeded", {
        referenceId: reference.id,
        actorId,
        newVersion,
        correlationId,
      });

      return committed;
    } catch (err: any) {
      if (err instanceof SecretVaultError) throw err;
      this.emitAuditEvent("secret_rotation_failed", {
        referenceId: reference.id,
        actorId,
        reason: err?.message || "rotation_failed",
        correlationId,
      });
      throw new SecretVaultError("rotation_failed", `Secret rotation failed for '${reference.id}': ${err?.message || "error"}`);
    }
  }

  /**
   * Exposure Response: Reports a suspected/confirmed secret leak, marks status, and raises HIGH/CRITICAL security event.
   */
  async reportExposure(report: SecretExposureReport, correlationId: string): Promise<SecretReference> {
    const reference = await this.store.getReference(report.referenceId);
    if (!reference) throw new SecretNotFoundError(report.referenceId);

    const status = report.exposureLevel === "CRITICAL" || report.exposureLevel === "HIGH" ? "compromised" : "suspected_leak";
    const updated = await this.store.updateReference(reference.id, { status });

    // Clear cache to prevent serving compromised credentials
    this.cache.clear();

    this.emitAuditEvent("possible_secret_exposure", {
      referenceId: reference.id,
      kind: reference.kind,
      reportedBy: report.reportedBy,
      exposureLevel: report.exposureLevel,
      status,
      correlationId,
    });

    if (this.securityEvents) {
      await this.securityEvents.upsert({
        id: `sec_exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        eventId: `evt_sec_exp_${Date.now()}`,
        eventType: "ANOMALOUS_ACCESS",
        severity: report.exposureLevel,
        description: `Possible secret exposure reported for secret reference '${reference.id}' (${reference.secretName}). Status updated to ${status}. Evidence: ${report.evidence}`,
        status: "OPEN",
        createdAt: new Date().toISOString(),
      });
    }

    return updated;
  }

  private emitAuditEvent(event: string, meta: Record<string, unknown>): void {
    if (this.auditLog) {
      this.auditLog.log(event, meta);
    }
  }
}
