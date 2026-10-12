import type { SecretReference } from "../../contracts/secrets.js";
import { SecretValue } from "./secret-value.js";

export class SecretVaultError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SecretVaultError";
  }
}

export class SecretNotFoundError extends SecretVaultError {
  constructor(refId: string) {
    super("secret_not_found", `Secret reference '${refId}' could not be resolved in the vault provider.`);
  }
}

export class SecretProviderUnconfiguredError extends SecretVaultError {
  constructor(providerName: string) {
    super("provider_unconfigured", `Secret vault provider '${providerName}' is not configured in this environment.`);
  }
}

/**
 * Provider-agnostic interface for secret vault integrations.
 * Business and domain logic NEVER touch Google Secret Manager, AWS KMS, or HashiCorp Vault directly.
 */
export interface SecretProvider {
  readonly name: string;
  getSecret(ref: SecretReference): Promise<SecretValue>;
  putSecret?(ref: SecretReference, value: string): Promise<SecretReference>;
  rotateSecret?(ref: SecretReference, newValue: string): Promise<SecretReference>;
  disableVersion?(ref: SecretReference, version: string): Promise<void>;
}
