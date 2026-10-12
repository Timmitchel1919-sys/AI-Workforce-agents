import type {
  AutonomyPolicyTier,
  DataClassification,
  EmergencyControlAction,
  TrustEntity,
  GovernanceTrustLevel,
  ApprovalExplanation,
} from "../../contracts/trust-governance.js";

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
  priority: number; // Higher number = evaluated earlier, but safest restriction takes precedence on conflict
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
  type:
    | "repeated_denials"
    | "action_frequency_spike"
    | "unexpected_sensitive_data_access"
    | "cost_spike";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  metrics: Record<string, unknown>;
  detectedAt: string;
}

const PRIVILEGED_ACTION_PATTERNS: readonly RegExp[] = [
  /^delete_project$/i,
  /^delete_repository$/i,
  /^delete_workflow$/i,
  /^delete_agent$/i,
  /^delete_integration$/i,
  /^modify_secret$/i,
  /^delete_secret$/i,
  /^rotate_secret_force$/i,
  /^database_drop_/i,
  /^database_truncate_/i,
  /^destroy_infrastructure$/i,
  /^destroy_production$/i,
  /^disable_security_control$/i,
  /^bypass_policy$/i,
  /^purge_backups$/i,
];

const DATA_CLASS_RANKS: Record<DataClassification, number> = {
  public: 1,
  internal: 2,
  sensitive: 3,
  restricted: 4,
};

const TRUST_LEVEL_RANKS: Record<GovernanceTrustLevel, number> = {
  untrusted: 0,
  limited: 1,
  standard: 2,
  trusted: 3,
  privileged: 4,
};

export class TrustEngine {
  private customPolicies: GovernancePolicyRule[] = [];

  constructor(customPolicies?: readonly GovernancePolicyRule[]) {
    if (customPolicies) {
      this.customPolicies = [...customPolicies];
    }
  }

  public registerPolicy(policy: GovernancePolicyRule): void {
    this.customPolicies.push(policy);
  }

  /**
   * Identifies whether an action is inherently a privileged, high-impact destructive operation.
   */
  public isPrivilegedAction(action: string): boolean {
    return PRIVILEGED_ACTION_PATTERNS.some((pattern) => pattern.test(action));
  }

  /**
   * Evaluates an AI action request against trust levels, autonomy policies, data governance,
   * emergency lockdown states, and policy rules.
   *
   * DETERMINISTIC CONFLICT RESOLUTION:
   * Safer restriction wins (DENY > APPROVAL_REQUIRED > ALLOW).
   */
  public evaluateAction(
    context: ActionGovernanceContext,
    options: {
      agentEntity?: TrustEntity;
      toolEntity?: TrustEntity;
      emergencyLockedDown?: boolean;
      activeLocks?: readonly { action: EmergencyControlAction; targetId?: string }[];
    } = {},
  ): PolicyEvaluationResult {
    const matchedPolicies: string[] = [];

    // 1. Check Global Emergency Controls
    if (options.emergencyLockedDown) {
      return {
        decision: "deny",
        matchedPolicies: ["emergency_lockdown_global"],
        reason: "Global emergency automation lockdown is active. All autonomous actions are suspended.",
        isPrivilegedAction: this.isPrivilegedAction(context.action),
        requiresHumanApproval: false,
        blockedByEmergencyControl: true,
      };
    }

    // 2. Check Specific Emergency Locks
    if (options.activeLocks && options.activeLocks.length > 0) {
      for (const lock of options.activeLocks) {
        if (
          lock.action === "lock_down_high_risk_actions" &&
          (context.riskLevel === "high" || context.riskLevel === "critical")
        ) {
          return {
            decision: "deny",
            matchedPolicies: ["emergency_lock_high_risk"],
            reason: "Emergency lockdown on high-risk actions is currently in effect.",
            isPrivilegedAction: this.isPrivilegedAction(context.action),
            requiresHumanApproval: false,
            blockedByEmergencyControl: true,
          };
        }
        if (lock.action === "pause_automation" && context.actorType !== "human") {
          return {
            decision: "deny",
            matchedPolicies: ["emergency_lock_pause_automation"],
            reason: "Automation is paused by operator emergency order.",
            isPrivilegedAction: this.isPrivilegedAction(context.action),
            requiresHumanApproval: false,
            blockedByEmergencyControl: true,
          };
        }
        if (lock.action === "stop_agent" && lock.targetId === context.agentId) {
          return {
            decision: "deny",
            matchedPolicies: ["emergency_lock_agent_stopped"],
            reason: `Agent ${context.agentId} has been suspended via emergency control.`,
            isPrivilegedAction: this.isPrivilegedAction(context.action),
            requiresHumanApproval: false,
            blockedByEmergencyControl: true,
          };
        }
        if (lock.action === "stop_workflow" && lock.targetId === context.workflowId) {
          return {
            decision: "deny",
            matchedPolicies: ["emergency_lock_workflow_stopped"],
            reason: `Workflow ${context.workflowId} has been stopped via emergency control.`,
            isPrivilegedAction: this.isPrivilegedAction(context.action),
            requiresHumanApproval: false,
            blockedByEmergencyControl: true,
          };
        }
        if (
          lock.action === "revoke_permission" &&
          lock.targetId !== undefined &&
          (lock.targetId === context.agentId || lock.targetId === context.toolId)
        ) {
          return {
            decision: "deny",
            matchedPolicies: ["emergency_lock_permission_revoked"],
            reason: `Permissions for ${lock.targetId} have been revoked via emergency control.`,
            isPrivilegedAction: this.isPrivilegedAction(context.action),
            requiresHumanApproval: false,
            blockedByEmergencyControl: true,
          };
        }
        if (lock.action === "disable_tool" && lock.targetId === context.toolId) {
          return {
            decision: "deny",
            matchedPolicies: ["emergency_lock_tool_disabled"],
            reason: `Tool ${context.toolId} is disabled by emergency order.`,
            isPrivilegedAction: this.isPrivilegedAction(context.action),
            requiresHumanApproval: false,
            blockedByEmergencyControl: true,
          };
        }
      }
    }

    // 3. Agent Trust Level Validation
    if (options.agentEntity) {
      if (options.agentEntity.trustLevel === "untrusted") {
        return {
          decision: "deny",
          matchedPolicies: ["agent_untrusted_deny"],
          reason: `Agent ${options.agentEntity.displayName} has an UNTRUSTED classification and cannot execute operations.`,
          isPrivilegedAction: this.isPrivilegedAction(context.action),
          requiresHumanApproval: false,
        };
      }
    }

    // 4. Data Governance Scope Check
    if (context.dataClassification && options.agentEntity) {
      const allowedClasses = options.agentEntity.permittedDataClasses;
      const targetRank = DATA_CLASS_RANKS[context.dataClassification] ?? 1;
      const maxAllowedRank = Math.max(
        ...allowedClasses.map((c) => DATA_CLASS_RANKS[c] ?? 1),
        1,
      );

      if (targetRank > maxAllowedRank) {
        return {
          decision: "deny",
          matchedPolicies: ["data_governance_scope_exceeded"],
          reason: `Agent ${options.agentEntity.displayName} lacks clearance for ${context.dataClassification.toUpperCase()} data. Permitted ceiling is ${options.agentEntity.permittedDataClasses.join(", ")}.`,
          isPrivilegedAction: this.isPrivilegedAction(context.action),
          requiresHumanApproval: false,
        };
      }
    }

    // 5. Privileged Action Interception
    const isPrivileged = this.isPrivilegedAction(context.action);
    if (isPrivileged) {
      matchedPolicies.push("privileged_action_protection");
      if (
        options.agentEntity &&
        TRUST_LEVEL_RANKS[options.agentEntity.trustLevel] < TRUST_LEVEL_RANKS.trusted
      ) {
        return {
          decision: "deny",
          matchedPolicies: [...matchedPolicies, "privileged_requires_trusted_agent"],
          reason: `Agent ${options.agentEntity.displayName} (${options.agentEntity.trustLevel.toUpperCase()}) is not trusted to request privileged action "${context.action}".`,
          isPrivilegedAction: true,
          requiresHumanApproval: false,
        };
      }
      if (!context.hasApprovedApprovalId) {
        return {
          decision: "approval_required",
          matchedPolicies,
          reason: `Action "${context.action}" is classified as a privileged, high-impact destructive operation requiring explicit human operator approval.`,
          isPrivilegedAction: true,
          requiresHumanApproval: true,
          requiredApprovalLevel: "privileged",
        };
      }
    }

    // 6. Autonomy Policy Evaluation based on Risk Level
    // LOW RISK -> Automatic
    // MEDIUM RISK -> Policy dependent
    // HIGH RISK -> Human approval
    // CRITICAL -> Explicit human approval
    let autonomyDecision: PolicyDecisionOutcome = "allow";
    let autonomyReason = "Action permitted under autonomy policy.";
    let requiresHumanApproval = false;
    let requiredApprovalLevel: "standard" | "privileged" = "standard";

    if (context.riskLevel === "critical") {
      autonomyDecision = "approval_required";
      autonomyReason = "Critical-risk actions require explicit human approval.";
      requiresHumanApproval = true;
      requiredApprovalLevel = "privileged";
      matchedPolicies.push("autonomy_critical_risk_approval");
    } else if (context.riskLevel === "high") {
      autonomyDecision = "approval_required";
      autonomyReason = "High-risk actions require human approval.";
      requiresHumanApproval = true;
      requiredApprovalLevel = "standard";
      matchedPolicies.push("autonomy_high_risk_approval");
    } else if (context.riskLevel === "medium") {
      // Evaluate registered policies
      for (const policy of this.customPolicies) {
        if (policy.actionPattern.test(context.action)) {
          matchedPolicies.push(policy.id);
          // Conflict resolution: prefer safer restriction
          if (policy.decision === "deny") {
            return {
              decision: "deny",
              matchedPolicies,
              reason: `Blocked by policy: ${policy.name} (${policy.description})`,
              isPrivilegedAction: isPrivileged,
              requiresHumanApproval: false,
            };
          }
          if (policy.decision === "approval_required") {
            autonomyDecision = "approval_required";
            autonomyReason = `Policy ${policy.name} requires operator approval: ${policy.description}`;
            requiresHumanApproval = true;
          }
        }
      }
    } else {
      matchedPolicies.push("autonomy_low_risk_auto");
    }

    // If approval was already granted via approvalId, allow execution
    if (autonomyDecision === "approval_required" && context.hasApprovedApprovalId) {
      return {
        decision: "allow",
        matchedPolicies: [...matchedPolicies, "approved_by_operator"],
        reason: `Action was authorized under human approval ID ${context.hasApprovedApprovalId}.`,
        isPrivilegedAction: isPrivileged,
        requiresHumanApproval: false,
      };
    }

    return {
      decision: autonomyDecision,
      matchedPolicies,
      reason: autonomyReason,
      isPrivilegedAction: isPrivileged,
      requiresHumanApproval,
      requiredApprovalLevel: requiresHumanApproval ? requiredApprovalLevel : undefined,
    };
  }

  /**
   * Generates a structured explainability record for human oversight before approval.
   */
  public generateApprovalExplanation(
    context: ActionGovernanceContext,
    evaluation: PolicyEvaluationResult,
  ): ApprovalExplanation {
    const risks: string[] = [];

    if (evaluation.isPrivilegedAction) {
      risks.push("Destructive operation with permanent deletion or infrastructure impact.");
    }
    if (context.environment === "production") {
      risks.push("Direct mutation of production environment assets.");
    }
    if (context.dataClassification === "sensitive" || context.dataClassification === "restricted") {
      risks.push(`Access or modification of ${context.dataClassification.toUpperCase()} sensitive information.`);
    }
    if (risks.length === 0) {
      risks.push(`Operational risk classified at ${context.riskLevel.toUpperCase()} tier.`);
    }

    return {
      what: `Execute action "${context.action}" targeting resource "${context.targetResource}".`,
      why: `Requested by ${context.actorType === "agent" ? `Agent (${context.agentId ?? "unknown"})` : context.actorId} to advance task objectives.`,
      basedOn: `Policy evaluation matching rules [${evaluation.matchedPolicies.join(", ")}].`,
      expectedResult: `Execution will apply target state updates to ${context.targetResource} within project ${context.projectId ?? "global"}.`,
      risks,
      confidence: evaluation.isPrivilegedAction ? "medium" : "high",
      requiredApprovalLevel: evaluation.requiredApprovalLevel ?? "standard",
    };
  }

  /**
   * Detects unusual behavioral patterns and anomalies across agent execution telemetry.
   */
  public detectAnomalies(metric: AnomalyDetectionMetric): AnomalyAlert[] {
    const alerts: AnomalyAlert[] = [];
    const nowIso = new Date().toISOString();

    // 1. Repeated denials threshold
    if (metric.deniedActionCountInWindow >= 3) {
      alerts.push({
        id: `anom_deny_${metric.agentId}_${Date.now()}`,
        agentId: metric.agentId,
        projectId: metric.projectId,
        type: "repeated_denials",
        severity: metric.deniedActionCountInWindow >= 5 ? "high" : "medium",
        description: `Agent ${metric.agentId} attempted ${metric.deniedActionCountInWindow} actions that were denied by security/trust policy in the active window.`,
        metrics: { deniedActionCount: metric.deniedActionCountInWindow },
        detectedAt: nowIso,
      });
    }

    // 2. Action frequency spike (> 3x average)
    if (
      metric.averageActionsPerMinute > 0 &&
      metric.actionsPerMinute > metric.averageActionsPerMinute * 3 &&
      metric.actionsPerMinute > 15
    ) {
      alerts.push({
        id: `anom_spike_${metric.agentId}_${Date.now()}`,
        agentId: metric.agentId,
        projectId: metric.projectId,
        type: "action_frequency_spike",
        severity: "medium",
        description: `Agent ${metric.agentId} execution frequency spiked to ${metric.actionsPerMinute} actions/min (baseline: ${metric.averageActionsPerMinute} actions/min).`,
        metrics: {
          currentRate: metric.actionsPerMinute,
          baselineRate: metric.averageActionsPerMinute,
        },
        detectedAt: nowIso,
      });
    }

    // 3. Unexpected sensitive data access
    if (metric.sensitiveDataAccessCount > 5) {
      alerts.push({
        id: `anom_sens_${metric.agentId}_${Date.now()}`,
        agentId: metric.agentId,
        projectId: metric.projectId,
        type: "unexpected_sensitive_data_access",
        severity: "high",
        description: `Agent ${metric.agentId} performed ${metric.sensitiveDataAccessCount} sensitive/restricted data reads in the active window.`,
        metrics: { count: metric.sensitiveDataAccessCount },
        detectedAt: nowIso,
      });
    }

    // 4. Unusual cost spike
    if (
      metric.expectedCostInWindowUSD > 0 &&
      metric.estimatedCostInWindowUSD > metric.expectedCostInWindowUSD * 2.5 &&
      metric.estimatedCostInWindowUSD > 5.0
    ) {
      alerts.push({
        id: `anom_cost_${metric.agentId}_${Date.now()}`,
        agentId: metric.agentId,
        projectId: metric.projectId,
        type: "cost_spike",
        severity: "medium",
        description: `Agent ${metric.agentId} cost exceeded projected baseline ($${metric.estimatedCostInWindowUSD.toFixed(2)} vs expected $${metric.expectedCostInWindowUSD.toFixed(2)}).`,
        metrics: {
          cost: metric.estimatedCostInWindowUSD,
          expectedCost: metric.expectedCostInWindowUSD,
        },
        detectedAt: nowIso,
      });
    }

    return alerts;
  }
}
