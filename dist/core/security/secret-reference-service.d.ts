import { type ManagedSecretReference, type ManagedSecretReferenceDraft, type ManagedSecretReferenceUpdate, type OperatorPrincipal, type Repository } from "../../contracts/index.js";
import type { DestructiveApproverResolver, SecurityExecutionEvidence } from "./destructive-action-service.js";
export interface SecretReferenceMutationContext {
    correlationId: string;
    destructiveActionId: string;
    environment: "local" | "test" | "staging" | "production";
    evidence: SecurityExecutionEvidence;
    approverResolver?: DestructiveApproverResolver;
}
export interface SecretReferenceMutationAuthorization {
    authorized: boolean;
    reason?: string;
    complete?: () => void | Promise<void>;
    fail?: (reason: string) => void | Promise<void>;
}
export interface SecretReferenceMutationAuthorizer {
    authorize(input: {
        principal: OperatorPrincipal;
        operation: "create" | "update";
        proposed: ManagedSecretReference;
        context: SecretReferenceMutationContext;
    }): Promise<SecretReferenceMutationAuthorization>;
}
/** Durable metadata catalog. Raw secret material cannot be represented here. */
export declare class SecretReferenceService {
    private readonly repository;
    private readonly authorizer?;
    private readonly clock;
    constructor(repository: Repository<ManagedSecretReference>, authorizer?: SecretReferenceMutationAuthorizer | undefined, clock?: () => string);
    list(principal: OperatorPrincipal): ManagedSecretReference[];
    create(principal: OperatorPrincipal, draft: ManagedSecretReferenceDraft, context: SecretReferenceMutationContext): Promise<ManagedSecretReference>;
    update(principal: OperatorPrincipal, ref: string, update: ManagedSecretReferenceUpdate, context: SecretReferenceMutationContext): Promise<ManagedSecretReference>;
    private requireMutationCapability;
    private persistAuthorized;
}
