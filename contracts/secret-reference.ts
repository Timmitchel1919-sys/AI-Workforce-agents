import type { SecretReference } from "./execution.js";
import type { Entity } from "./persistence.js";

export const SECRET_REFERENCE_PROVIDERS = [
  "gcp_secret_manager",
  "azure_key_vault",
  "aws_secrets_manager",
  "external_vault",
] as const;
export type SecretReferenceProvider =
  (typeof SECRET_REFERENCE_PROVIDERS)[number];

export const SECRET_REFERENCE_STATUSES = [
  "active",
  "disabled",
  "rotation_required",
] as const;
export type SecretReferenceStatus = (typeof SECRET_REFERENCE_STATUSES)[number];

/** Metadata only. This contract deliberately has no secret/value/token field. */
export interface ManagedSecretReference extends Entity {
  id: string;
  ref: SecretReference;
  provider: SecretReferenceProvider;
  providerResource: string;
  projectId?: string;
  purpose: string;
  status: SecretReferenceStatus;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  lastRotatedAt?: string;
  rotationDueAt?: string;
}

export interface ManagedSecretReferenceDraft {
  ref: SecretReference;
  provider: SecretReferenceProvider;
  providerResource: string;
  projectId?: string;
  purpose: string;
  rotationDueAt?: string;
}

export interface ManagedSecretReferenceUpdate {
  providerResource?: string;
  purpose?: string;
  status?: SecretReferenceStatus;
  lastRotatedAt?: string;
  rotationDueAt?: string;
}
