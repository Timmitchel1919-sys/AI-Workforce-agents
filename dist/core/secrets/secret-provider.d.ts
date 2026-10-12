import type { SecretReference } from "../../contracts/secrets.js";
import { SecretValue } from "./secret-value.js";
export declare class SecretVaultError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare class SecretNotFoundError extends SecretVaultError {
    constructor(refId: string);
}
export declare class SecretProviderUnconfiguredError extends SecretVaultError {
    constructor(providerName: string);
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
