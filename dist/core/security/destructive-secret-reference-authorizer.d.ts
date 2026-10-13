import { ManagedSecretReference, OperatorPrincipal } from "../../contracts/index.js";
import { DestructiveActionService } from "./destructive-action-service.js";
import type { SecretReferenceMutationAuthorization, SecretReferenceMutationAuthorizer, SecretReferenceMutationContext } from "./secret-reference-service.js";
export declare class DestructiveSecretReferenceMutationAuthorizer implements SecretReferenceMutationAuthorizer {
    private readonly destructiveActions;
    constructor(destructiveActions: DestructiveActionService);
    authorize(input: {
        principal: OperatorPrincipal;
        operation: "create" | "update";
        proposed: ManagedSecretReference;
        context: SecretReferenceMutationContext;
    }): Promise<SecretReferenceMutationAuthorization>;
}
