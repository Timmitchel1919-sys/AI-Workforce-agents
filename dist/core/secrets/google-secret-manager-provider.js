import { SecretNotFoundError, SecretVaultError } from "./secret-provider.js";
import { SecretValue } from "./secret-value.js";
/**
 * Production secret provider for Google Cloud Secret Manager.
 * Uses Application Default Credentials (ADC) or Workload Identity.
 * Business logic never imports or calls SecretManagerServiceClient directly.
 */
export class GoogleSecretManagerProvider {
    name = "gcp_secret_manager";
    clientPromise;
    projectId;
    constructor(options = {}) {
        this.projectId = options.gcpProjectId ?? (typeof process !== "undefined" ? process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID : undefined);
        if (options.clientSeam) {
            this.clientPromise = Promise.resolve(options.clientSeam);
        }
    }
    async getClient() {
        if (!this.clientPromise) {
            this.clientPromise = (async () => {
                try {
                    const sdkName = "@google-cloud/secret-manager";
                    const mod = await import(sdkName);
                    return new mod.SecretManagerServiceClient();
                }
                catch {
                    throw new SecretVaultError("gcp_sdk_not_installed", "The '@google-cloud/secret-manager' SDK is not installed. Install it to enable production Secret Manager access.");
                }
            })();
        }
        return this.clientPromise;
    }
    async getSecret(ref) {
        const client = await this.getClient();
        const project = ref.projectId || this.projectId;
        if (!project) {
            throw new SecretVaultError("gcp_project_missing", `GCP project id is unconfigured for secret reference '${ref.id}'.`);
        }
        const version = ref.version ?? "latest";
        const name = `projects/${project}/secrets/${ref.secretName}/versions/${version}`;
        try {
            const [response] = await client.accessSecretVersion(name);
            const payload = response.payload?.data;
            if (!payload) {
                throw new SecretNotFoundError(ref.id);
            }
            const secretString = typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8");
            return new SecretValue(secretString, { version });
        }
        catch (err) {
            if (err instanceof SecretVaultError)
                throw err;
            if (err?.code === 5 || err?.message?.includes("NOT_FOUND")) {
                throw new SecretNotFoundError(ref.id);
            }
            throw new SecretVaultError("gcp_secret_access_failed", `Failed to retrieve secret '${ref.secretName}' from Secret Manager: ${err?.message || "internal error"}`);
        }
    }
}
