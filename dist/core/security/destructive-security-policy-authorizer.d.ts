import { OperatorPrincipal, SecurityPolicy } from "../../contracts/index.js";
import { DestructiveActionService, type DestructiveApproverResolver, type SecurityExecutionEvidence } from "./destructive-action-service.js";
import type { SecurityPolicyMutationAuthorization, SecurityPolicyMutationAuthorizer, SecurityPolicyMutationContext } from "./security-policy-service.js";
/**
 * Binds a policy mutation to a previously approved destructive-action record.
 * The target tuple is fixed here and cannot be weakened by request JSON.
 */
export declare class DestructiveSecurityPolicyMutationAuthorizer implements SecurityPolicyMutationAuthorizer {
    private readonly destructiveActions;
    constructor(destructiveActions: DestructiveActionService);
    authorize(input: {
        principal: OperatorPrincipal;
        current?: SecurityPolicy;
        proposed: SecurityPolicy;
        context: SecurityPolicyMutationContext;
    }): Promise<SecurityPolicyMutationAuthorization>;
}
export type { DestructiveApproverResolver, SecurityExecutionEvidence };
