import type { SecretReference } from "../../contracts/secrets.js";
import { type SecretProvider } from "./secret-provider.js";
import { SecretValue } from "./secret-value.js";
export interface GoogleSecretManagerOptions {
    gcpProjectId?: string;
    clientSeam?: {
        accessSecretVersion(name: string): Promise<[{
            payload?: {
                data?: Buffer | string;
            };
        }]>;
    };
}
/**
 * Production secret provider for Google Cloud Secret Manager.
 * Uses Application Default Credentials (ADC) or Workload Identity.
 * Business logic never imports or calls SecretManagerServiceClient directly.
 */
export declare class GoogleSecretManagerProvider implements SecretProvider {
    readonly name = "gcp_secret_manager";
    private clientPromise?;
    private readonly projectId?;
    constructor(options?: GoogleSecretManagerOptions);
    private getClient;
    getSecret(ref: SecretReference): Promise<SecretValue>;
}
