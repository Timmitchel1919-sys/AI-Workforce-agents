import { type OperatorPrincipal } from "../../contracts/index.js";
import type { SecretExposureReport, SecretReference, SecretRotationPolicy } from "../../contracts/secrets.js";
import type { SecretVault } from "../../core/secrets/secret-vault.js";
export interface CreateSecretReferenceInput {
    provider: string;
    kind: SecretReference["kind"];
    scope: SecretReference["scope"];
    projectId?: string;
    environment?: string;
    integrationId?: string;
    secretName: string;
    version?: string;
}
export interface SecretControlServiceOptions {
    vault: SecretVault;
    audit?: {
        log(event: string, meta?: Record<string, unknown>): void;
    };
}
/**
 * Control Plane service for managing secret references, rotation policies, and exposure reports.
 *
 * CRITICAL INVARIANT: This service NEVER exposes or returns raw secret values over API calls.
 */
export declare class SecretControlService {
    private readonly vault;
    private readonly audit?;
    constructor(options: SecretControlServiceOptions);
    private requireCapability;
    listReferences(principal: OperatorPrincipal, projectId?: string): Promise<SecretReference[]>;
    getReference(principal: OperatorPrincipal, id: string): Promise<SecretReference | undefined>;
    createReference(principal: OperatorPrincipal, input: CreateSecretReferenceInput): Promise<SecretReference>;
    setRotationPolicy(principal: OperatorPrincipal, policy: Omit<SecretRotationPolicy, "createdAt" | "updatedAt">): Promise<SecretRotationPolicy>;
    reportExposure(principal: OperatorPrincipal, report: Omit<SecretExposureReport, "reportedBy">, correlationId: string): Promise<SecretReference>;
}
