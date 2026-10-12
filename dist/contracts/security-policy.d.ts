export declare const SECURITY_RISK_LEVELS: readonly ["low", "medium", "high", "critical"];
export type SecurityRiskLevel = (typeof SECURITY_RISK_LEVELS)[number];
export interface SecurityPolicyDecision {
    allowed: boolean;
    action: string;
    risk: SecurityRiskLevel;
    requiresApproval: boolean;
    requiresReauthentication: boolean;
    requiresMfa: boolean;
    requiresTwoPersonApproval: boolean;
    reason: string;
    matchedPolicyIds: readonly string[];
    recommendedAlternative?: string;
}
export interface SecurityActionContext {
    action: string;
    actorId: string;
    actorType: "human" | "agent" | "system";
    actorRole?: string;
    agentId?: string;
    projectId?: string;
    environment?: string;
    targetResourceType?: string;
    targetResourceId?: string;
    destructive: boolean;
    irreversible: boolean;
    production: boolean;
    requestedAt: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
}
export interface SecurityPolicy {
    id: string;
    description: string;
    enabled: boolean;
    /** If provided, matches context.action against these strings/patterns */
    actionPatterns?: readonly string[];
    risk: SecurityRiskLevel;
    productionOnly?: boolean;
    destructiveOnly?: boolean;
    requiresApproval: boolean;
    requiresReauthentication: boolean;
    requiresMfa: boolean;
    requiresTwoPersonApproval: boolean;
    deny: boolean;
    recommendedAlternative?: string;
}
export declare function validateSecurityActionContext(context: SecurityActionContext): void;
