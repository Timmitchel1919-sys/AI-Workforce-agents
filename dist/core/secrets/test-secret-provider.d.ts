import type { SecretReference } from "../../contracts/secrets.js";
import { type SecretProvider } from "./secret-provider.js";
import { SecretValue } from "./secret-value.js";
/**
 * In-memory test provider for unit tests.
 */
export declare class TestSecretProvider implements SecretProvider {
    readonly name = "test";
    private readonly secrets;
    private readonly versions;
    constructor(initialSecrets?: Record<string, string>);
    setTestSecret(key: string, value: string, version?: string): void;
    getSecret(ref: SecretReference): Promise<SecretValue>;
    putSecret(ref: SecretReference, value: string): Promise<SecretReference>;
    rotateSecret(ref: SecretReference, newValue: string): Promise<SecretReference>;
    disableVersion(ref: SecretReference, version: string): Promise<void>;
}
