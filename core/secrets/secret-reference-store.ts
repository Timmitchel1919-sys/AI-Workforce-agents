import type { Repository } from "../../contracts/persistence.js";
import type { SecretReference, SecretRotationPolicy } from "../../contracts/secrets.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";

/**
 * Persistence store for SecretReferences and SecretRotationPolicies.
 * Stores ONLY reference metadata — NEVER secret values.
 */
export class SecretReferenceStore {
  constructor(
    private readonly references: Repository<SecretReference> = new InMemoryRepository<SecretReference>(),
    private readonly rotationPolicies: Repository<SecretRotationPolicy> = new InMemoryRepository<SecretRotationPolicy>()
  ) {}

  async createReference(ref: Omit<SecretReference, "createdAt" | "updatedAt" | "status"> & { status?: SecretReference["status"] }): Promise<SecretReference> {
    const now = new Date().toISOString();
    const created: SecretReference = {
      ...ref,
      status: ref.status ?? "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.references.upsert(created);
    return created;
  }

  async getReference(id: string): Promise<SecretReference | undefined> {
    return this.references.findById(id);
  }

  async listReferences(projectId?: string): Promise<SecretReference[]> {
    const all = await this.references.list();
    if (!projectId) return all;
    return all.filter((r) => !r.projectId || r.projectId === "*" || r.projectId === projectId);
  }

  async updateReference(id: string, update: Partial<Omit<SecretReference, "id" | "createdAt">>): Promise<SecretReference> {
    const existing = await this.references.findById(id);
    if (!existing) {
      throw new Error(`Secret reference '${id}' not found.`);
    }
    const updated: SecretReference = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString(),
    };
    await this.references.upsert(updated);
    return updated;
  }

  async setRotationPolicy(policy: Omit<SecretRotationPolicy, "createdAt" | "updatedAt">): Promise<SecretRotationPolicy> {
    const created: SecretRotationPolicy = { ...policy };
    await this.rotationPolicies.upsert(created);

    // Wire rotationPolicyId back onto reference
    await this.updateReference(policy.secretRefId, { rotationPolicyId: policy.id });
    return created;
  }

  async getRotationPolicy(id: string): Promise<SecretRotationPolicy | undefined> {
    return this.rotationPolicies.findById(id);
  }

  async getRotationPolicyForSecret(secretRefId: string): Promise<SecretRotationPolicy | undefined> {
    const all = await this.rotationPolicies.list();
    return all.find((p) => p.secretRefId === secretRefId);
  }
}
