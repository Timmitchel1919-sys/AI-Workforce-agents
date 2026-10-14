import { PermissionDeniedError, operatorCan, operatorCanAccessProject, } from "../../contracts/index.js";
import { normalizeSecurityEvent } from "./security-event-normalizer.js";
export class SecretRotationService {
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
    isDueForRotation(reference, nowIso = this.clock()) {
        const nowMs = Date.parse(nowIso);
        if (reference.rotationDueAt &&
            Date.parse(reference.rotationDueAt) <= nowMs) {
            return true;
        }
        if (reference.rotationPolicy?.enabled &&
            reference.rotationPolicy.intervalDays &&
            reference.lastRotatedAt) {
            const lastRotatedMs = Date.parse(reference.lastRotatedAt);
            const intervalMs = reference.rotationPolicy.intervalDays * 24 * 60 * 60 * 1000;
            if (nowMs - lastRotatedMs >= intervalMs) {
                return true;
            }
        }
        return false;
    }
    async rotate(principal, reference, newSecretValue, context) {
        if (!operatorCan(principal, "manage_secret_references")) {
            throw new PermissionDeniedError("manage_secret_references capability required to rotate secrets");
        }
        if (reference.projectId &&
            !operatorCanAccessProject(principal, reference.projectId)) {
            throw new PermissionDeniedError(`Operator has no access to project '${reference.projectId}'`);
        }
        if (this.policyEngine) {
            const decision = this.policyEngine.evaluate({
                action: "secret.rotate",
                actorId: principal.id,
                actorType: "human",
                role: principal.role,
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
                throw new PermissionDeniedError(`Security policy denied rotation: ${decision.reason}`);
            }
        }
        if (!this.vault.rotate) {
            throw new Error(`Vault provider does not support rotation for secret '${reference.id}'`);
        }
        const now = this.clock();
        // 1. Mark rotating
        const rotatingRecord = {
            ...reference,
            status: "rotating",
            updatedAt: now,
            updatedBy: principal.id,
        };
        this.repository.upsert(rotatingRecord);
        await this.recordEvent("secret_rotation_started", "succeeded", context, reference.id, {
            fromVersion: reference.version,
        });
        try {
            // 2. Rotate in vault provider
            const rotateResult = await this.vault.rotate(reference, newSecretValue, context);
            // 3. Mark validating
            const validatingRecord = {
                ...rotatingRecord,
                status: "validating",
                version: Number(rotateResult.newVersion) || reference.version + 1,
                updatedAt: this.clock(),
            };
            this.repository.upsert(validatingRecord);
            // 4. Test resolution of new credential
            const testLease = await this.vault.resolve(validatingRecord, context);
            if (!testLease.value) {
                throw new Error("Validation check failed: new secret resolved empty value");
            }
            testLease.dispose();
            // 5. Successful validation -> active
            const nextDueAt = this.computeNextDueAt(validatingRecord, now);
            const activeRecord = {
                ...validatingRecord,
                status: "active",
                lastRotatedAt: now,
                rotationDueAt: nextDueAt,
                updatedAt: this.clock(),
                updatedBy: principal.id,
            };
            this.repository.upsert(activeRecord);
            await this.recordEvent("secret_rotation_succeeded", "succeeded", context, reference.id, {
                newVersion: activeRecord.version,
                nextDueAt,
            });
            return activeRecord;
        }
        catch (error) {
            // Rotation or validation failed: preserve old credential in repository, mark rotation_failed
            const failedRecord = {
                ...reference,
                status: "rotation_failed",
                updatedAt: this.clock(),
                updatedBy: principal.id,
            };
            this.repository.upsert(failedRecord);
            const msg = error instanceof Error ? error.message : String(error);
            await this.recordEvent("secret_rotation_failed", "failed", context, reference.id, {
                error: msg,
                preservedVersion: reference.version,
            });
            throw error;
        }
    }
    async emergencyRevoke(principal, reference, context) {
        if (!operatorCan(principal, "manage_secret_references")) {
            throw new PermissionDeniedError("manage_secret_references capability required to revoke secrets");
        }
        if (reference.projectId &&
            !operatorCanAccessProject(principal, reference.projectId)) {
            throw new PermissionDeniedError(`Operator has no access to project '${reference.projectId}'`);
        }
        if (this.policyEngine) {
            const decision = this.policyEngine.evaluate({
                action: "revoke.secret",
                actorId: principal.id,
                actorType: "human",
                role: principal.role,
                environment: context.environment,
                targetResourceType: "secret_reference",
                targetResourceId: reference.id,
                projectId: reference.projectId,
                destructive: true,
                irreversible: false,
                production: context.environment === "production",
                requestedAt: context.requestedAt,
                correlationId: context.correlationId,
            });
            if (!decision.allowed) {
                throw new PermissionDeniedError(`Security policy denied emergency revoke: ${decision.reason}`);
            }
        }
        if (this.vault.revoke) {
            await this.vault.revoke(reference, context);
        }
        const now = this.clock();
        const revokedRecord = {
            ...reference,
            status: "revoked",
            updatedAt: now,
            updatedBy: principal.id,
        };
        this.repository.upsert(revokedRecord);
        await this.recordEvent("secret_reference_revoked", "succeeded", context, reference.id, {
            revokedBy: principal.id,
            reason: "EMERGENCY_REVOCATION",
        });
        return revokedRecord;
    }
    computeNextDueAt(record, lastRotatedIso) {
        if (record.rotationPolicy?.enabled && record.rotationPolicy.intervalDays) {
            const nextMs = Date.parse(lastRotatedIso) +
                record.rotationPolicy.intervalDays * 24 * 60 * 60 * 1000;
            return new Date(nextMs).toISOString();
        }
        return record.rotationDueAt;
    }
    async recordEvent(type, outcome, context, referenceId, evidence) {
        if (!this.securityEvents)
            return;
        try {
            await this.securityEvents.append(normalizeSecurityEvent({
                eventId: `sec-rot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                occurredAt: this.clock(),
                category: "secrets",
                type,
                severity: outcome === "succeeded" ? "low" : "high",
                outcome,
                actor: { kind: context.principalType, id: context.principalId },
                source: { kind: "secret_rotation_service" },
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
            // Non-blocking for audit event failures
        }
    }
}
