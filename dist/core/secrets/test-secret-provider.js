import { SecretNotFoundError } from "./secret-provider.js";
import { SecretValue } from "./secret-value.js";
/**
 * In-memory test provider for unit tests.
 */
export class TestSecretProvider {
    name = "test";
    secrets = new Map();
    versions = new Map();
    constructor(initialSecrets = {}) {
        for (const [k, v] of Object.entries(initialSecrets)) {
            this.secrets.set(k, v);
        }
    }
    setTestSecret(key, value, version = "latest") {
        this.secrets.set(key, value);
        let vers = this.versions.get(key);
        if (!vers) {
            vers = new Map();
            this.versions.set(key, vers);
        }
        vers.set(version, value);
    }
    async getSecret(ref) {
        const version = ref.version ?? "latest";
        const vers = this.versions.get(ref.secretName) ?? this.versions.get(ref.id);
        if (vers && vers.has(version)) {
            return new SecretValue(vers.get(version), { version });
        }
        const value = this.secrets.get(ref.secretName) ?? this.secrets.get(ref.id);
        if (value === undefined) {
            throw new SecretNotFoundError(ref.id);
        }
        return new SecretValue(value, { version });
    }
    async putSecret(ref, value) {
        const nextVersion = String((this.versions.get(ref.secretName)?.size ?? 0) + 1);
        this.setTestSecret(ref.secretName, value, nextVersion);
        this.setTestSecret(ref.secretName, value, "latest");
        return {
            ...ref,
            version: nextVersion,
            updatedAt: new Date().toISOString(),
        };
    }
    async rotateSecret(ref, newValue) {
        return this.putSecret(ref, newValue);
    }
    async disableVersion(ref, version) {
        const vers = this.versions.get(ref.secretName);
        if (vers) {
            vers.delete(version);
        }
    }
}
