import type { Entity } from "./persistence.js";

export type SecretKind =
  | "api_key"
  | "oauth_client_secret"
  | "service_account"
  | "access_token"
  | "refresh_token"
  | "webhook_secret"
  | "signing_key"
  | "deployment_credential"
  | "database_credential"
  | "model_provider_key"
  | "github_credential"
  | "integration_credential"
  | "other";

export type SecretScope =
  | "global"
  | "project"
  | "environment"
  | "integration"
  | "agent"
  | "deployment";

export type SecretStatus = "active" | "suspected_leak" | "compromised" | "disabled" | "deprecated";

/**
 * Metadata reference to a secret stored in a vault provider.
 * CRITICAL INVARIANT: SecretReference MUST NEVER contain the raw secret value.
 */
export interface SecretReference extends Entity {
  id: string;
  provider: string; // e.g. 'env', 'gcp_secret_manager', 'test'
  kind: SecretKind;
  scope: SecretScope;
  projectId?: string;
  environment?: string;
  integrationId?: string;
  secretName: string;
  version?: string; // e.g. 'latest' or '1'
  status: SecretStatus;
  createdAt: string;
  updatedAt: string;
  rotationPolicyId?: string;
  lastRotatedAt?: string;
}

export interface SecretRotationPolicy extends Entity {
  id: string;
  secretRefId: string;
  enabled: boolean;
  intervalDays: number;
  maxAgeDays: number;
  notifyBeforeDays: number;
  automaticRotationSupported: boolean;
  requiresApproval: boolean;
  lastRotatedAt?: string;
  nextRotationDueAt?: string;
}

export type SecretAccessPurpose =
  | "deploy_release"
  | "call_model_provider"
  | "github_push"
  | "webhook_validation"
  | "firebase_admin_operation"
  | "runner_execution"
  | "manage_secret_references"
  | "emergency_break_glass";

export interface SecretAccessRequest {
  referenceId: string;
  actorId: string;
  actorType: "user" | "agent" | "system" | "tool";
  projectId?: string;
  environment?: string;
  purpose: SecretAccessPurpose;
  correlationId: string;
  breakGlassReason?: string;
}

export interface SecretAccessDecision {
  allowed: boolean;
  reason?: string;
  referenceId: string;
  actorId: string;
  purpose: SecretAccessPurpose;
}

export interface SecretExposureReport {
  referenceId: string;
  reportedBy: string;
  evidence: string;
  exposureLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reportedAt: string;
}
