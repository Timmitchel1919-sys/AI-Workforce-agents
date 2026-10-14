import type { SecretReference } from "./execution.js";
import type { Entity } from "./persistence.js";
export declare const SECRET_REFERENCE_PROVIDERS: readonly ["gcp_secret_manager", "azure_key_vault", "aws_secrets_manager", "external_vault", "in_memory_vault"];
export type SecretReferenceProvider = (typeof SECRET_REFERENCE_PROVIDERS)[number];
export declare const SECRET_REFERENCE_STATUSES: readonly ["active", "rotation_due", "rotation_required", "rotating", "validating", "disabled", "revoked", "expired", "unavailable", "rotation_failed"];
export type SecretReferenceStatus = (typeof SECRET_REFERENCE_STATUSES)[number];
export interface SecretRotationPolicy {
    enabled: boolean;
    intervalDays?: number;
    rotateBeforeExpiryDays?: number;
    manualApprovalRequired?: boolean;
}
/** Metadata only. This contract deliberately has no secret/value/token field. */
export interface ManagedSecretReference extends Entity {
    id: string;
    ref: SecretReference;
    name?: string;
    provider: SecretReferenceProvider;
    providerResource: string;
    providerSecretId?: string;
    projectId?: string;
    purpose: string;
    environment?: "local" | "test" | "staging" | "production";
    allowedConsumers?: readonly string[];
    allowedCapabilities?: readonly string[];
    status: SecretReferenceStatus;
    version: number;
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
    lastRotatedAt?: string;
    rotationDueAt?: string;
    rotationPolicy?: SecretRotationPolicy;
    expiresAt?: string;
    metadata?: Readonly<Record<string, unknown>>;
}
export interface ManagedSecretReferenceDraft {
    ref: SecretReference;
    name?: string;
    provider: SecretReferenceProvider;
    providerResource: string;
    providerSecretId?: string;
    projectId?: string;
    purpose: string;
    environment?: "local" | "test" | "staging" | "production";
    allowedConsumers?: readonly string[];
    allowedCapabilities?: readonly string[];
    rotationDueAt?: string;
    rotationPolicy?: SecretRotationPolicy;
    expiresAt?: string;
    metadata?: Readonly<Record<string, unknown>>;
}
export interface ManagedSecretReferenceUpdate {
    providerResource?: string;
    providerSecretId?: string;
    purpose?: string;
    status?: SecretReferenceStatus;
    lastRotatedAt?: string;
    rotationDueAt?: string;
    rotationPolicy?: SecretRotationPolicy;
    expiresAt?: string;
    allowedConsumers?: readonly string[];
    metadata?: Readonly<Record<string, unknown>>;
}
