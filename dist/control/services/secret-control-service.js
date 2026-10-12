import { PermissionDeniedError, operatorCan } from "../../contracts/index.js";
/**
 * Control Plane service for managing secret references, rotation policies, and exposure reports.
 *
 * CRITICAL INVARIANT: This service NEVER exposes or returns raw secret values over API calls.
 */
export class SecretControlService {
    vault;
    audit;
    constructor(options) {
        this.vault = options.vault;
        this.audit = options.audit;
    }
    requireCapability(principal, capability) {
        if (!operatorCan(principal, capability)) {
            throw new PermissionDeniedError(`Operator '${principal.id}' lacks capability '${capability}' required for secret management.`);
        }
    }
    async listReferences(principal, projectId) {
        this.requireCapability(principal, "view_security");
        const refs = await this.vault.getStore().listReferences(projectId);
        // Project isolation filtering
        if (principal.allowedProjects !== "*") {
            const allowed = new Set(principal.allowedProjects);
            return refs.filter((r) => !r.projectId || r.projectId === "*" || allowed.has(r.projectId));
        }
        return refs;
    }
    async getReference(principal, id) {
        this.requireCapability(principal, "view_security");
        const ref = await this.vault.getStore().getReference(id);
        if (!ref)
            return undefined;
        if (principal.allowedProjects !== "*" && ref.projectId && ref.projectId !== "*") {
            if (!principal.allowedProjects.includes(ref.projectId)) {
                throw new PermissionDeniedError(`Operator '${principal.id}' is not authorized for project '${ref.projectId}'.`);
            }
        }
        return ref;
    }
    async createReference(principal, input) {
        this.requireCapability(principal, "manage_secret_references");
        if (principal.allowedProjects !== "*" && input.projectId && input.projectId !== "*") {
            if (!principal.allowedProjects.includes(input.projectId)) {
                throw new PermissionDeniedError(`Operator '${principal.id}' is not authorized for project '${input.projectId}'.`);
            }
        }
        const ref = await this.vault.getStore().createReference({
            id: `sec_ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            provider: input.provider,
            kind: input.kind,
            scope: input.scope,
            projectId: input.projectId,
            environment: input.environment,
            integrationId: input.integrationId,
            secretName: input.secretName,
            version: input.version ?? "latest",
            status: "active",
        });
        if (this.audit) {
            this.audit.log("secret_reference_created", {
                referenceId: ref.id,
                kind: ref.kind,
                scope: ref.scope,
                projectId: ref.projectId,
                actorId: principal.id,
            });
        }
        return ref;
    }
    async setRotationPolicy(principal, policy) {
        this.requireCapability(principal, "manage_secret_references");
        const ref = await this.vault.getStore().getReference(policy.secretRefId);
        if (!ref)
            throw new Error(`Secret reference '${policy.secretRefId}' not found.`);
        if (principal.allowedProjects !== "*" && ref.projectId && ref.projectId !== "*") {
            if (!principal.allowedProjects.includes(ref.projectId)) {
                throw new PermissionDeniedError(`Operator '${principal.id}' is not authorized for project '${ref.projectId}'.`);
            }
        }
        const created = await this.vault.getStore().setRotationPolicy(policy);
        if (this.audit) {
            this.audit.log("secret_rotation_policy_set", {
                policyId: created.id,
                secretRefId: created.secretRefId,
                intervalDays: created.intervalDays,
                actorId: principal.id,
            });
        }
        return created;
    }
    async reportExposure(principal, report, correlationId) {
        this.requireCapability(principal, "manage_secret_references");
        const fullReport = {
            ...report,
            reportedBy: principal.id,
        };
        return this.vault.reportExposure(fullReport, correlationId);
    }
}
