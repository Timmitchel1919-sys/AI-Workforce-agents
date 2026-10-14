import { NotFoundError, PermissionDeniedError, ValidationError, operatorCan, operatorCanAccessProject, } from "../../contracts/index.js";
import { normalizeSecurityEvent } from "./security-event-normalizer.js";
export class SecretAccessService {
    vault;
    repository;
    policyEngine;
    securityEvents;
    clock;
    constructor(options) {
        this.vault = options.vault;
        this.repository = options.repository;
        this.policyEngine = options.policyEngine;
        this.securityEvents = options.securityEvents;
        this.clock = options.clock ?? (() => new Date().toISOString());
    }
    async resolve(caller, referenceIdOrRef, context) {
        const id = referenceIdOrRef.startsWith("secret://")
            ? referenceIdOrRef.slice("secret://".length)
            : referenceIdOrRef;
        const reference = this.repository.findById(id);
        if (!reference) {
            await this.recordEvent("secret_access_denied", "denied", context, id, {
                reason: "SECRET_REFERENCE_NOT_FOUND",
            });
            throw new NotFoundError(`Secret reference not found: '${id}'`);
        }
        // 1 & 2: Permission check
        if ("role" in caller) {
            // Operator caller
            const hasCap = operatorCan(caller, "use_secret_reference") ||
                operatorCan(caller, "manage_secret_references");
            if (!hasCap) {
                await this.recordEvent("secret_access_denied", "denied", context, id, {
                    reason: "CAPABILITY_DENIED: use_secret_reference required",
                });
                throw new PermissionDeniedError("use_secret_reference or manage_secret_references capability required");
            }
            if (reference.projectId &&
                !operatorCanAccessProject(caller, reference.projectId)) {
                await this.recordEvent("secret_access_denied", "denied", context, id, {
                    reason: `PROJECT_SCOPE_DENIED: no access to ${reference.projectId}`,
                });
                throw new PermissionDeniedError(`Operator has no access to project '${reference.projectId}'`);
            }
        }
        else {
            // Agent / service / system caller
            if (!context.principalId || !context.purpose) {
                throw new ValidationError("principalId and purpose required in secret access context");
            }
        }
        // 3. Project scope validation in context
        if (reference.projectId &&
            context.projectId &&
            reference.projectId !== context.projectId) {
            await this.recordEvent("secret_access_denied", "denied", context, id, {
                reason: "PROJECT_MISMATCH",
            });
            throw new PermissionDeniedError(`Secret reference belongs to project '${reference.projectId}', context specified '${context.projectId}'`);
        }
        // 4. Environment binding validation
        if (reference.environment &&
            reference.environment !== context.environment) {
            await this.recordEvent("secret_access_denied", "denied", context, id, {
                reason: "ENVIRONMENT_MISMATCH",
                expected: reference.environment,
                actual: context.environment,
            });
            throw new PermissionDeniedError(`Secret environment mismatch: reference is bound to '${reference.environment}', requested in '${context.environment}'`);
        }
        // 5. Status validation (active or rotation_due only)
        if (reference.status === "disabled" ||
            reference.status === "revoked" ||
            reference.status === "unavailable" ||
            reference.status === "rotation_failed") {
            await this.recordEvent("secret_access_denied", "denied", context, id, {
                reason: `INVALID_STATUS_${reference.status.toUpperCase()}`,
                status: reference.status,
            });
            throw new PermissionDeniedError(`Secret reference '${id}' cannot be resolved in status '${reference.status}'`);
        }
        // 6. Expiry check
        const nowIso = this.clock();
        if (reference.expiresAt &&
            Date.parse(reference.expiresAt) <= Date.parse(nowIso)) {
            if (reference.status !== "expired") {
                this.repository.upsert({
                    ...reference,
                    status: "expired",
                    updatedAt: nowIso,
                });
            }
            await this.recordEvent("secret_expired", "denied", context, id, {
                expiresAt: reference.expiresAt,
            });
            throw new PermissionDeniedError(`Secret reference '${id}' has expired`);
        }
        // 7. Allowed consumer check
        if (reference.allowedConsumers && reference.allowedConsumers.length > 0) {
            const allowed = reference.allowedConsumers.includes("*") ||
                reference.allowedConsumers.includes(context.principalId) ||
                reference.allowedConsumers.includes(context.principalType) ||
                reference.allowedConsumers.includes(`${context.principalType}:${context.principalId}`);
            if (!allowed) {
                await this.recordEvent("secret_access_denied", "denied", context, id, {
                    reason: "CONSUMER_NOT_ALLOWED",
                    principalId: context.principalId,
                    principalType: context.principalType,
                });
                throw new PermissionDeniedError(`Consumer '${context.principalId}' is not authorized to access secret '${id}'`);
            }
        }
        // 8. Purpose validation
        if (!context.purpose || !context.purpose.trim()) {
            throw new ValidationError("A non-empty purpose is required to resolve a secret reference");
        }
        // 9. Policy engine evaluation
        if (this.policyEngine) {
            const decision = this.policyEngine.evaluate({
                action: "secret.resolve",
                actorId: context.principalId,
                actorType: context.principalType,
                environment: context.environment,
                targetResourceType: "secret_reference",
                targetResourceId: reference.id,
                projectId: reference.projectId,
                destructive: false,
                irreversible: false,
                production: context.environment === "production",
                requestedAt: context.requestedAt,
                correlationId: context.correlationId,
            });
            if (!decision.allowed) {
                await this.recordEvent("secret_access_denied", "denied", context, id, {
                    reason: decision.reason,
                    policyIds: decision.matchedPolicyIds,
                });
                throw new PermissionDeniedError(`Security policy denied secret resolution: ${decision.reason}`);
            }
        }
        // 10. Vault resolution
        try {
            const lease = await this.vault.resolve(reference, context);
            await this.recordEvent("secret_access_granted", "succeeded", context, id, {
                provider: reference.provider,
                purpose: context.purpose,
                version: lease.version,
            });
            return lease;
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            await this.recordEvent("secret_resolution_failed", "failed", context, id, {
                error: msg,
            });
            throw error;
        }
    }
    async recordEvent(type, outcome, context, referenceId, evidence) {
        if (!this.securityEvents)
            return;
        try {
            await this.securityEvents.append(normalizeSecurityEvent({
                eventId: `sec-evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                occurredAt: this.clock(),
                category: "secrets",
                type,
                severity: outcome === "succeeded" ? "low" : "medium",
                outcome,
                actor: { kind: context.principalType, id: context.principalId },
                source: { kind: "secret_access_service" },
                target: {
                    kind: "secret_reference",
                    id: referenceId,
                    projectId: context.projectId,
                },
                projectId: context.projectId,
                correlationId: context.correlationId,
                evidence: Object.freeze(evidence),
            }));
        }
        catch {
            // Event persistence failure should not mask secret security denial
        }
    }
}
