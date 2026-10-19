import {
  StateTransitionError,
  OperatorPrincipal,
  SecurityPolicy,
} from "../../contracts/index.js";
import {
  DestructiveActionService,
  type DestructiveApproverResolver,
  type SecurityExecutionEvidence,
} from "./destructive-action-service.js";
import type {
  SecurityPolicyMutationAuthorization,
  SecurityPolicyMutationAuthorizer,
  SecurityPolicyMutationContext,
} from "./security-policy-service.js";

/**
 * Binds a policy mutation to a previously approved destructive-action record.
 * The target tuple is fixed here and cannot be weakened by request JSON.
 */
export class DestructiveSecurityPolicyMutationAuthorizer implements SecurityPolicyMutationAuthorizer {
  constructor(private readonly destructiveActions: DestructiveActionService) {}

  async authorize(input: {
    principal: OperatorPrincipal;
    current?: SecurityPolicy;
    proposed: SecurityPolicy;
    context: SecurityPolicyMutationContext;
  }): Promise<SecurityPolicyMutationAuthorization> {
    const { context, principal, proposed } = input;
    const request = this.destructiveActions.get(context.destructiveActionId);
    if (!request || request.action !== "security_policy.mutate") {
      throw new StateTransitionError(
        "destructive approval is not bound to security_policy.mutate",
      );
    }
    await this.destructiveActions.assertApproved({
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
        this.destructiveActions.markExecuted(
          context.destructiveActionId,
          principal.id,
          Object.freeze({
            operation: input.current
              ? "security_policy.updated"
              : "security_policy.created",
            policyId: proposed.id,
            correlationId: context.correlationId,
          }),
        );
      },
      fail: (reason) => {
        this.destructiveActions.markFailed(
          context.destructiveActionId,
          principal.id,
          reason,
        );
      },
    };
  }
}

export type { DestructiveApproverResolver, SecurityExecutionEvidence };
