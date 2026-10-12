import type { DataClassification, EmergencyControlAction, TrustEntity, GovernanceTrustLevel, ApprovalExplanation } from "../../contracts/trust-governance.js";
export interface ActionGovernanceContext {
    actorId: string;
    actorType: "human" | "agent" | "system";
    agentId?: string;
    projectId?: string;
    workflowId?: string;
    taskId?: string;
    toolId?: string;
    modelId?: string;
    action: string;
    targetResource: string;
    dataClassification?: DataClassification;
    riskLevel: "low" | "medium" | "high" | "critical";
    environment?: "development" | "staging" | "production";
    hasApprovedApprovalId?: string;
}
export type PolicyDecisionOutcome = "allow" | "deny" | "approval_required";
export interface PolicyEvaluationResult {
    decision: PolicyDecisionOutcome;
    matchedPolicies: readonly string[];
    reason: string;
    isPrivilegedAction: boolean;
    requiresHumanApproval: boolean;
    requiredApprovalLevel?: "standard" | "privileged";
    blockedByEmergencyControl?: boolean;
}
export interface GovernancePolicyRule {
    id: string;
    name: string;
    description: string;
    actionPattern: RegExp;
    minRiskLevel?: "low" | "medium" | "high" | "critical";
    requiredTrustLevel?: GovernanceTrustLevel;
    maxPermittedDataClass?: DataClassification;
    decision: PolicyDecisionOutcome;
    priority: number;
}
export interface AnomalyDetectionMetric {
    agentId: string;
    projectId?: string;
    deniedActionCountInWindow: number;
    actionsPerMinute: number;
    averageActionsPerMinute: number;
    sensitiveDataAccessCount: number;
    estimatedCostInWindowUSD: number;
    expectedCostInWindowUSD: number;
}
export interface AnomalyAlert {
    id: string;
    agentId: string;
    projectId?: string;
    type: "repeated_denials" | "action_frequency_spike" | "unexpected_sensitive_data_access" | "cost_spike";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    metrics: Record<string, unknown>;
    detectedAt: string;
}
export declare class TrustEngine {
    private customPolicies;
    constructor(customPolicies?: readonly GovernancePolicyRule[]);
    registerPolicy(policy: GovernancePolicyRule): void;
    /**
     * Identifies whether an action is inherently a privileged, high-impact destructive operation.
     */
    isPrivilegedAction(action: string): boolean;
    /**
     * Evaluates an AI action request against trust levels, autonomy policies, data governance,
     * emergency lockdown states, and policy rules.
     *
     * DETERMINISTIC CONFLICT RESOLUTION:
     * Safer restriction wins (DENY > APPROVAL_REQUIRED > ALLOW).
     */
    evaluateAction(context: ActionGovernanceContext, options?: {
        agentEntity?: TrustEntity;
        toolEntity?: TrustEntity;
        emergencyLockedDown?: boolean;
        activeLocks?: readonly {
            action: EmergencyControlAction;
            targetId?: string;
        }[];
    }): PolicyEvaluationResult;
    /**
     * Generates a structured explainability record for human oversight before approval.
     */
    generateApprovalExplanation(context: ActionGovernanceContext, evaluation: PolicyEvaluationResult): ApprovalExplanation;
    /**
     * Detects unusual behavioral patterns and anomalies across agent execution telemetry.
     */
    detectAnomalies(metric: AnomalyDetectionMetric): AnomalyAlert[];
}
