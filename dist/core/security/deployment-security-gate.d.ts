import { type AsyncSecurityEventStore, type OperatorPrincipal, type SecurityFinding } from "../../contracts/index.js";
import type { SecurityFindingStore } from "./security-finding-source.js";
import type { SecurityPolicyEngine } from "./security-policy-engine.js";
export interface SecurityOverrideRequest {
    principal: OperatorPrincipal;
    findingIds: readonly string[];
    justification: string;
    expiresAt: string;
    approvalId?: string;
    reauthVerified?: boolean;
    mfaVerified?: boolean;
}
export interface DeploymentGateEvaluation {
    allowed: boolean;
    blockedFindings: SecurityFinding[];
    reason: string;
    overrideApplied?: boolean;
}
export declare class DeploymentSecurityGate {
    private readonly findingStore;
    private readonly policyEngine?;
    private readonly securityEvents?;
    private readonly clock;
    constructor(findingStore: SecurityFindingStore, policyEngine?: SecurityPolicyEngine | undefined, securityEvents?: AsyncSecurityEventStore | undefined, clock?: () => string);
    evaluateDeployment(environment: "staging" | "production" | "test" | "local", projectId?: string, override?: SecurityOverrideRequest): DeploymentGateEvaluation;
    private recordEvent;
}
