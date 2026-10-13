import { StateTransitionError, } from "../../contracts/index.js";
export class DestructiveSecretReferenceMutationAuthorizer {
    destructiveActions;
    constructor(destructiveActions) {
        this.destructiveActions = destructiveActions;
    }
    async authorize(input) {
        const { context, principal, proposed } = input;
        const expectedAction = `secret.reference.${input.operation}`;
        const request = this.destructiveActions.get(context.destructiveActionId);
        if (!request || request.action !== expectedAction) {
            throw new StateTransitionError(`destructive approval is not bound to ${expectedAction}`);
        }
        this.destructiveActions.assertApproved({
            requestId: context.destructiveActionId,
            principal,
            actionType: "other_destructive",
            targetResourceType: "secret_reference",
            targetResourceId: proposed.id,
            environment: context.environment,
            projectId: proposed.projectId,
            evidence: context.evidence,
            approverResolver: context.approverResolver,
        });
        return {
            authorized: true,
            complete: () => {
                this.destructiveActions.markExecuted(context.destructiveActionId, principal.id, Object.freeze({
                    operation: `secret_reference.${input.operation}`,
                    secretReference: proposed.ref,
                    correlationId: context.correlationId,
                }));
            },
            fail: (reason) => {
                this.destructiveActions.markFailed(context.destructiveActionId, principal.id, reason);
            },
        };
    }
}
