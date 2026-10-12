import type { Repository } from "../../contracts/persistence.js";
import type { SecretReference, SecretRotationPolicy } from "../../contracts/secrets.js";
/**
 * Persistence store for SecretReferences and SecretRotationPolicies.
 * Stores ONLY reference metadata — NEVER secret values.
 */
export declare class SecretReferenceStore {
    private readonly references;
    private readonly rotationPolicies;
    constructor(references?: Repository<SecretReference>, rotationPolicies?: Repository<SecretRotationPolicy>);
    createReference(ref: Omit<SecretReference, "createdAt" | "updatedAt" | "status"> & {
        status?: SecretReference["status"];
    }): Promise<SecretReference>;
    getReference(id: string): Promise<SecretReference | undefined>;
    listReferences(projectId?: string): Promise<SecretReference[]>;
    updateReference(id: string, update: Partial<Omit<SecretReference, "id" | "createdAt">>): Promise<SecretReference>;
    setRotationPolicy(policy: Omit<SecretRotationPolicy, "createdAt" | "updatedAt">): Promise<SecretRotationPolicy>;
    getRotationPolicy(id: string): Promise<SecretRotationPolicy | undefined>;
    getRotationPolicyForSecret(secretRefId: string): Promise<SecretRotationPolicy | undefined>;
}
