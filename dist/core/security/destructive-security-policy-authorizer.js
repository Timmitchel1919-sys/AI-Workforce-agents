import { StateTransitionError, } from "../../contracts/index.js";
/**
 * Binds a policy mutation to a previously approved destructive-action record.
 * The target tuple is fixed here and cannot be weakened by request JSON.
 */
export class DestructiveSecurityPolicyMutationAuthorizer {
    destructiveActions;
    constructor(destructiveActions) {
        this.destructiveActions = destructiveActions;
    }
    async authorize(input) {
        const { context, principal, proposed } = input;
        const request = this.destructiveActions.get(context.destructiveActionId);
        if (!request || request.action !== "security_policy.mutate") {
            throw new StateTransitionError("destructive approval is not bound to security_policy.mutate");
        }
        this.destructiveActions.assertApproved({
            requestId: context.destructiveActionId,
            principal,
            actionType: "other_destructive",
            targetResourceType: "security_policy",
            targetResourceId: proposed.id,
            environment: context.environment,
            evidence: context.evidence,
            approverResolver: context.approverResolver,
        });
        return {
            authorized: true,
            approvalId: context.destructiveActionId,
            complete: () => {
                this.destructiveActions.markExecuted(context.destructiveActionId, principal.id, Object.freeze({
                    operation: input.current
                        ? "security_policy.updated"
                        : "security_policy.created",
                    policyId: proposed.id,
                    correlationId: context.correlationId,
                }));
            },
            fail: (reason) => {
                this.destructiveActions.markFailed(context.destructiveActionId, principal.id, reason);
            },
        };
    }
}
