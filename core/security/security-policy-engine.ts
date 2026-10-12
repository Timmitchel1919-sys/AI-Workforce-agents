import type {
  SecurityActionContext,
  SecurityPolicy,
  SecurityPolicyDecision,
  SecurityRiskLevel,
} from "../../contracts/security-policy.js";

const RISK_RANKS: Record<SecurityRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const DEFAULT_SECURITY_POLICIES: readonly SecurityPolicy[] = [
  {
    id: "sp-audit-log-deletion-deny",
    description: "Audit records are protected from destructive mutation",
    enabled: true,
    actionPatterns: ["delete_audit_log", "clear_audit_log"],
    risk: "critical",
    requiresApproval: false,
    requiresReauthentication: false,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: true,
  },
  {
    id: "sp-security-event-deletion-deny",
    description: "Security events and incidents cannot be arbitrarily deleted",
    enabled: true,
    actionPatterns: ["delete_security_incident", "delete_security_event", "clear_security_events"],
    risk: "critical",
    requiresApproval: false,
    requiresReauthentication: false,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: true,
  },
  {
    id: "sp-secrets-raw-read-deny",
    description: "Raw secret values cannot be read directly",
    enabled: true,
    actionPatterns: ["expose_secret", "export_secret", "read_raw_secret"],
    risk: "critical",
    requiresApproval: false,
    requiresReauthentication: false,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: true,
  },
  {
    id: "sp-backup-deletion-protection",
    description: "Backup deletion is a critical destructive action requiring approval, retention verification and MFA",
    enabled: true,
    actionPatterns: ["delete_backup", "delete_backup_record", "purge_backups", "destroy_backup"],
    risk: "critical",
    requiresApproval: true,
    requiresReauthentication: true,
    requiresMfa: true,
    requiresTwoPersonApproval: true,
    deny: false,
    recommendedAlternative: "retain until retention policy expires or archive to cold immutable storage",
  },
  {
    id: "sp-recovery-execution-protection",
    description: "System and database recovery requires governed approval and safety evaluation",
    enabled: true,
    actionPatterns: ["restore_backup", "recover_system", "execute_recovery"],
    productionOnly: true,
    risk: "critical",
    requiresApproval: true,
    requiresReauthentication: true,
    requiresMfa: true,
    requiresTwoPersonApproval: false,
    deny: false,
    recommendedAlternative: "test restore in isolated drill environment first",
  },
  {
    id: "sp-production-deletion-protection",
    description: "Permanent production deletion requires extreme authorization",
    enabled: true,
    destructiveOnly: true,
    productionOnly: true,
    risk: "critical",
    requiresApproval: true,
    requiresReauthentication: true,
    requiresMfa: true,
    requiresTwoPersonApproval: false,
    deny: false,
    recommendedAlternative: "archive or soft-delete instead",
  },
  {
    id: "sp-destructive-action-protection",
    description: "Protection for all destructive non-production actions",
    enabled: true,
    destructiveOnly: true,
    risk: "high",
    requiresApproval: true,
    requiresReauthentication: false,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: false,
    recommendedAlternative: "archive or soft-delete instead",
  },
  {
    id: "sp-production-deployment",
    description: "Production deployments require governed approval",
    enabled: true,
    actionPatterns: ["deploy_release"],
    productionOnly: true,
    risk: "high",
    requiresApproval: true,
    requiresReauthentication: true,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: false,
  },
  {
    id: "sp-security-policy-changes",
    description: "Changes to security policies require strict reauthentication and approval",
    enabled: true,
    actionPatterns: [
      "manage_security_policy",
      "update_security_policy",
      "manage_security_incidents",
      "contain_security_threat",
    ],
    risk: "high",
    requiresApproval: true,
    requiresReauthentication: true,
    requiresMfa: true,
    requiresTwoPersonApproval: false,
    deny: false,
  },
  {
    id: "sp-identity-access-changes",
    description: "Privileged access modifications require elevated risk checks",
    enabled: true,
    actionPatterns: [
      "manage_access",
      "approve_access",
      "suspend_access",
      "revoke_access",
      "change_operator_role",
      "manage_identity_security",
    ],
    risk: "high",
    requiresApproval: true,
    requiresReauthentication: true,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: false,
  },
  {
    id: "sp-secrets-management",
    description: "Modifying secret references is high risk",
    enabled: true,
    actionPatterns: ["manage_secret_references", "update_credential_reference"],
    risk: "high",
    requiresApproval: true,
    requiresReauthentication: true,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: false,
  },
  {
    id: "sp-agent-security-changes",
    description: "Agent security and access modifications",
    enabled: true,
    actionPatterns: ["disable_agent", "enable_agent", "manage_agent_security"],
    risk: "medium",
    requiresApproval: false,
    requiresReauthentication: false,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: false,
  },
  {
    id: "sp-standard-mutations",
    description: "Standard operational control mutations",
    enabled: true,
    actionPatterns: [
      "retry_task",
      "pause_workflow",
      "resume_workflow",
      "cancel_task",
      "cancel_workflow",
      "create_execution_plan",
      "submit_execution_plan",
      "prepare_execution",
      "cancel_execution",
      "review_change",
      "commit_source",
      "push_source",
      "rollback_release",
      "plan_from_objective",
      "create_program",
      "create_workstream",
      "add_task_to_workstream",
      "tick_software_factory",
      "create_project",
      "manage_budget_policy",
      "manage_governance_policy",
      "onboarding_create",
      "onboarding_update",
      "onboarding_analyze",
      "onboarding_plan",
      "onboarding_approve_plan",
      "onboarding_provision",
      "onboarding_revalidate",
      "onboarding_cancel",
      "set_budget_policy",
      "set_governance_policy",
      "evaluate_governance",
    ],
    risk: "medium", // Environment context handles low/medium risk. Let's default to medium for mutations.
    requiresApproval: false,
    requiresReauthentication: false,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: false,
  },
  {
    id: "sp-read-actions",
    description: "Normal read operations",
    enabled: true,
    actionPatterns: ["view", "view_security", "view_security_events", "list_tasks", "get_status"],
    risk: "low",
    requiresApproval: false,
    requiresReauthentication: false,
    requiresMfa: false,
    requiresTwoPersonApproval: false,
    deny: false,
  },
];

export class SecurityPolicyEngine {
  constructor(private readonly policies: readonly SecurityPolicy[] = DEFAULT_SECURITY_POLICIES) {}

  evaluate(context: SecurityActionContext): SecurityPolicyDecision {
    const matched = this.matchPolicies(context);

    // Explicit deny for unknown destructive actions
    if (matched.length === 0 && context.destructive) {
      return {
        allowed: false,
        action: context.action,
        risk: "critical",
        requiresApproval: false,
        requiresReauthentication: false,
        requiresMfa: false,
        requiresTwoPersonApproval: false,
        reason: "Unknown destructive actions are denied by default",
        matchedPolicyIds: [],
      };
    }

    if (matched.length === 0) {
      // Unknown read/harmless action -> allowed by default (relying on prior RBAC)
      return {
        allowed: true,
        action: context.action,
        risk: "low",
        requiresApproval: false,
        requiresReauthentication: false,
        requiresMfa: false,
        requiresTwoPersonApproval: false,
        reason: "Action implicitly allowed (no overriding security policy)",
        matchedPolicyIds: [],
      };
    }

    const decision: SecurityPolicyDecision = {
      allowed: true,
      action: context.action,
      risk: "low",
      requiresApproval: false,
      requiresReauthentication: false,
      requiresMfa: false,
      requiresTwoPersonApproval: false,
      reason: "Allowed by security policy",
      matchedPolicyIds: matched.map((p) => p.id),
    };

    let deniedByPolicy = false;
    let denyReason = "";

    for (const policy of matched) {
      if (policy.deny) {
        deniedByPolicy = true;
        denyReason = policy.description;
      }
      if (RISK_RANKS[policy.risk] > RISK_RANKS[decision.risk]) {
        decision.risk = policy.risk;
      }
      if (policy.requiresApproval) decision.requiresApproval = true;
      if (policy.requiresReauthentication) decision.requiresReauthentication = true;
      if (policy.requiresMfa) decision.requiresMfa = true;
      if (policy.requiresTwoPersonApproval) decision.requiresTwoPersonApproval = true;
      if (policy.recommendedAlternative && !decision.recommendedAlternative) {
        decision.recommendedAlternative = policy.recommendedAlternative;
      }
    }

    if (deniedByPolicy) {
      decision.allowed = false;
      decision.reason = `Denied by policy: ${denyReason}`;
    }

    // Step 8: Protect against policy self-bypass (system invariants)
    this.enforceInvariants(context, decision);

    return decision;
  }

  private matchPolicies(context: SecurityActionContext): SecurityPolicy[] {
    return this.policies.filter((policy) => {
      if (!policy.enabled) return false;

      // Filter by environment/production
      if (policy.productionOnly && !context.production) return false;

      // Filter by destructive nature
      if (policy.destructiveOnly && !context.destructive) return false;

      // Filter by action patterns
      if (policy.actionPatterns && policy.actionPatterns.length > 0) {
        let actionMatch = false;
        for (const pattern of policy.actionPatterns) {
          if (pattern === context.action || (pattern.endsWith("*") && context.action.startsWith(pattern.slice(0, -1)))) {
            actionMatch = true;
            break;
          }
        }
        if (!actionMatch) return false;
      }

      return true;
    });
  }

  private enforceInvariants(context: SecurityActionContext, decision: SecurityPolicyDecision): void {
    // Audit log deletion remains denied.
    if (context.action === "delete_audit_log" || context.action === "clear_audit_log") {
      decision.allowed = false;
      decision.risk = "critical";
      decision.reason = "Invariant: Audit records are protected from destructive mutation";
    }

    // Critical production deletion cannot become zero-approval through a normal policy change.
    if (context.destructive && context.production) {
      decision.requiresApproval = true;
      if (RISK_RANKS[decision.risk] < RISK_RANKS["high"]) {
        decision.risk = "high"; // At least high risk
      }
    }

    // Security policy changes must themselves remain auditable and high risk
    if (context.action === "manage_security_policy") {
      decision.requiresApproval = true;
      decision.requiresReauthentication = true;
      if (RISK_RANKS[decision.risk] < RISK_RANKS["high"]) {
        decision.risk = "high";
      }
    }

    // Backup invariant: deletion of backups with active immutable retention is forbidden
    if (
      (context.action === "delete_backup" ||
        context.action === "delete_backup_record" ||
        context.action === "purge_backups" ||
        context.action === "destroy_backup") &&
      context.metadata?.immutableRetentionActive === true
    ) {
      decision.allowed = false;
      decision.risk = "critical";
      decision.reason =
        "Invariant: Deletion of backups protected by active immutable retention lock is forbidden";
    }
  }
}

