import type { OperatorPrincipal, Repository, SecurityPolicy } from "../../contracts/index.js";
import type { DestructiveApproverResolver, SecurityExecutionEvidence } from "./destructive-action-service.js";
export interface SecurityPolicyMutationContext {
    correlationId: string;
    destructiveActionId: string;
    environment: "local" | "test" | "staging" | "production";
    evidence: SecurityExecutionEvidence;
    approverResolver?: DestructiveApproverResolver;
}
export interface SecurityPolicyMutationAuthorization {
    authorized: boolean;
    approvalId?: string;
    reason?: string;
    complete?: () => void | Promise<void>;
    fail?: (reason: string) => void | Promise<void>;
}
export interface SecurityPolicyMutationAuthorizer {
    authorize(input: {
        principal: OperatorPrincipal;
        current?: SecurityPolicy;
        proposed: SecurityPolicy;
        context: SecurityPolicyMutationContext;
    }): Promise<SecurityPolicyMutationAuthorization>;
}
/** Durable policy administration without delete or raw client approval flags. */
export declare class SecurityPolicyService {
    private readonly repository;
    private readonly authorizer?;
    constructor(repository: Repository<SecurityPolicy>, authorizer?: SecurityPolicyMutationAuthorizer | undefined);
    list(principal: OperatorPrincipal): SecurityPolicy[];
    upsert(principal: OperatorPrincipal, proposed: SecurityPolicy, context: SecurityPolicyMutationContext): Promise<SecurityPolicy>;
}
