import { InMemoryRepository } from "../persistence/in-memory-repository.js";
/**
 * Persistence store for SecretReferences and SecretRotationPolicies.
 * Stores ONLY reference metadata — NEVER secret values.
 */
export class SecretReferenceStore {
    references;
    rotationPolicies;
    constructor(references = new InMemoryRepository(), rotationPolicies = new InMemoryRepository()) {
        this.references = references;
        this.rotationPolicies = rotationPolicies;
    }
    async createReference(ref) {
        const now = new Date().toISOString();
        const created = {
            ...ref,
            status: ref.status ?? "active",
            createdAt: now,
            updatedAt: now,
        };
        await this.references.upsert(created);
        return created;
    }
    async getReference(id) {
        return this.references.findById(id);
    }
    async listReferences(projectId) {
        const all = await this.references.list();
        if (!projectId)
            return all;
        return all.filter((r) => !r.projectId || r.projectId === "*" || r.projectId === projectId);
    }
    async updateReference(id, update) {
        const existing = await this.references.findById(id);
        if (!existing) {
            throw new Error(`Secret reference '${id}' not found.`);
        }
        const updated = {
            ...existing,
            ...update,
            updatedAt: new Date().toISOString(),
        };
        await this.references.upsert(updated);
        return updated;
    }
    async setRotationPolicy(policy) {
        const created = { ...policy };
        await this.rotationPolicies.upsert(created);
        // Wire rotationPolicyId back onto reference
        await this.updateReference(policy.secretRefId, { rotationPolicyId: policy.id });
        return created;
    }
    async getRotationPolicy(id) {
        return this.rotationPolicies.findById(id);
    }
    async getRotationPolicyForSecret(secretRefId) {
        const all = await this.rotationPolicies.list();
        return all.find((p) => p.secretRefId === secretRefId);
    }
}
