/**
 * Production SecretVault adapter for Google Cloud Secret Manager.
 * Uses official GCP Secret Manager conventions:
 *   projects/{projectId}/secrets/{secretId}/versions/{version}
 */
export class GoogleSecretManagerVault {
    client;
    defaultProjectId;
    lastAccess;
    lastError;
    constructor(options = {}) {
        this.client = options.client ?? null;
        this.defaultProjectId = options.projectId;
    }
    async getClient() {
        if (this.client)
            return this.client;
        try {
            // Dynamic import to allow graceful degradation when SDK is not present in local dev
            const gcp = (await Function('return import("@google-cloud/secret-manager")')());
            const ClientClass = gcp.SecretManagerServiceClient;
            this.client = new ClientClass();
            return this.client;
        }
        catch (error) {
            this.lastError =
                error instanceof Error
                    ? error.message
                    : "Failed to load SecretManagerServiceClient";
            throw new Error(`Google Cloud Secret Manager client unavailable: ${this.lastError}`);
        }
    }
    resolveResourceName(reference) {
        const resource = reference.providerResource;
        if (resource.startsWith("projects/")) {
            // Resource already qualified: projects/{project}/secrets/{secretId}[/versions/{version}]
            if (resource.includes("/versions/"))
                return resource;
            const version = reference.version ? String(reference.version) : "latest";
            return `${resource}/versions/${version}`;
        }
        const project = reference.projectId ?? this.defaultProjectId ?? "default";
        const secretId = reference.providerSecretId ?? reference.id;
        const version = reference.version ? String(reference.version) : "latest";
        return `projects/${project}/secrets/${secretId}/versions/${version}`;
    }
    async resolve(reference, _context) {
        const client = await this.getClient();
        const name = this.resolveResourceName(reference);
        try {
            const [response] = await client.accessSecretVersion({ name });
            const raw = response?.payload?.data;
            if (!raw) {
                throw new Error(`Secret payload missing for resource: ${name}`);
            }
            const value = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
            this.lastAccess = new Date().toISOString();
            let disposed = false;
            let leaseValue = value;
            return {
                referenceId: reference.id,
                get value() {
                    if (disposed || leaseValue === null) {
                        throw new Error("Secret lease has been disposed");
                    }
                    return leaseValue;
                },
                version: reference.version ? String(reference.version) : "latest",
                resolvedAt: new Date().toISOString(),
                expiresAt: reference.expiresAt,
                dispose() {
                    disposed = true;
                    leaseValue = null;
                },
            };
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to resolve secret from Google Secret Manager (${name}): ${this.lastError}`);
        }
    }
    async rotate(reference, newValue, _context) {
        const client = await this.getClient();
        if (!client.addSecretVersion) {
            throw new Error("addSecretVersion not supported by Secret Manager client");
        }
        const project = reference.projectId ?? this.defaultProjectId ?? "default";
        const secretId = reference.providerSecretId ?? reference.id;
        const parent = `projects/${project}/secrets/${secretId}`;
        try {
            const [versionResult] = await client.addSecretVersion({
                parent,
                payload: { data: Buffer.from(newValue, "utf8") },
            });
            const versionName = versionResult?.name ?? "";
            const versionNumber = versionName.split("/").pop() ?? String((reference.version || 1) + 1);
            return { newVersion: versionNumber };
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to rotate secret in Google Secret Manager (${parent}): ${this.lastError}`);
        }
    }
    async revoke(reference, _context) {
        const client = await this.getClient();
        if (!client.destroySecretVersion) {
            return;
        }
        const name = this.resolveResourceName(reference);
        try {
            await client.destroySecretVersion({ name });
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to revoke secret version in Google Secret Manager (${name}): ${this.lastError}`);
        }
    }
    async health() {
        return {
            configured: Boolean(this.client || this.defaultProjectId),
            reachable: this.lastError === undefined,
            provider: "gcp_secret_manager",
            lastSuccessfulAccess: this.lastAccess,
            lastFailure: this.lastError,
        };
    }
}
