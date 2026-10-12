import type { SecretReference } from "../../contracts/secrets.js";
import { type SecretProvider } from "./secret-provider.js";
import { SecretValue } from "./secret-value.js";
export interface EnvSecretProviderOptions {
    env?: Record<string, string | undefined>;
    allowProductionEnvSecrets?: boolean;
}
/**
 * Server-side development provider that reads secret values from process.env.
 *
 * SAFETY RULES:
 * 1. Reads ONLY from server-side `process.env`. Never reads from `import.meta.env` or browser state.
 * 2. Fails closed in production environments unless `allowProductionEnvSecrets: true` is explicitly passed.
 * 3. Never logs secret values.
 */
export declare class DevelopmentEnvSecretProvider implements SecretProvider {
    readonly name = "env";
    private readonly env;
    private readonly allowProduction;
    constructor(options?: EnvSecretProviderOptions);
    getSecret(ref: SecretReference): Promise<SecretValue>;
}
