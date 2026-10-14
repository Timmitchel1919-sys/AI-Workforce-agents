import type { ManagedSecretReference, ResolvedSecretLease, SecretAccessContext, SecretVault, SecretVaultHealth } from "../../contracts/index.js";
export interface SecretManagerServiceClientLike {
    accessSecretVersion(request: {
        name: string;
    }): Promise<[
        {
            payload?: {
                data?: string | Uint8Array | null;
            } | null;
        } | null | undefined
    ]>;
    addSecretVersion?(request: {
        parent: string;
        payload: {
            data: string | Uint8Array;
        };
    }): Promise<[{
        name?: string | null;
    } | null | undefined]>;
    destroySecretVersion?(request: {
        name: string;
    }): Promise<[unknown]>;
}
export interface GoogleSecretManagerVaultOptions {
    projectId?: string;
    client?: SecretManagerServiceClientLike;
}
/**
 * Production SecretVault adapter for Google Cloud Secret Manager.
 * Uses official GCP Secret Manager conventions:
 *   projects/{projectId}/secrets/{secretId}/versions/{version}
 */
export declare class GoogleSecretManagerVault implements SecretVault {
    private client;
    private readonly defaultProjectId?;
    private lastAccess?;
    private lastError?;
    constructor(options?: GoogleSecretManagerVaultOptions);
    private getClient;
    private resolveResourceName;
    resolve(reference: ManagedSecretReference, _context: SecretAccessContext): Promise<ResolvedSecretLease>;
    rotate(reference: ManagedSecretReference, newValue: string, _context: SecretAccessContext): Promise<{
        newVersion: string;
    }>;
    revoke(reference: ManagedSecretReference, _context: SecretAccessContext): Promise<void>;
    health(): Promise<SecretVaultHealth>;
}
