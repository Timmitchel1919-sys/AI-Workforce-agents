import { SecretNotFoundError, SecretVaultError } from "./secret-provider.js";
import { SecretValue } from "./secret-value.js";
/**
 * Server-side development provider that reads secret values from process.env.
 *
 * SAFETY RULES:
 * 1. Reads ONLY from server-side `process.env`. Never reads from `import.meta.env` or browser state.
 * 2. Fails closed in production environments unless `allowProductionEnvSecrets: true` is explicitly passed.
 * 3. Never logs secret values.
 */
export class DevelopmentEnvSecretProvider {
    name = "env";
    env;
    allowProduction;
    constructor(options = {}) {
        this.env = options.env ?? (typeof process !== "undefined" ? process.env : {});
        this.allowProduction = options.allowProductionEnvSecrets ?? false;
    }
    async getSecret(ref) {
        const nodeEnv = (this.env.NODE_ENV ?? "").toLowerCase();
        if (nodeEnv === "production" && !this.allowProduction) {
            throw new SecretVaultError("env_provider_production_disallowed", `DevelopmentEnvSecretProvider cannot resolve production secrets for reference '${ref.id}'. Configure a production Vault provider.`);
        }
        // Try resolving from secretName (or id) converted to uppercase environment variable key
        const envKey = ref.secretName.toUpperCase().replace(/[^A_Z0-9]/g, "_");
        const rawValue = this.env[ref.secretName] ?? this.env[envKey] ?? this.env[ref.id.toUpperCase()];
        if (!rawValue || !rawValue.trim()) {
            throw new SecretNotFoundError(ref.id);
        }
        return new SecretValue(rawValue.trim(), { version: ref.version ?? "latest" });
    }
}
