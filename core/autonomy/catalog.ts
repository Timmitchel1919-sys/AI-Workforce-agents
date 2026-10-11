/**
 * The action catalogue and the autonomy decision function. The decision is deterministic and
 * fail-closed: an action that is not in the catalogue is CRITICAL and restricted.
 */
import type {
  AutonomousAction,
  AutonomousWorkflowDef,
  OpsAutonomyLevel,
  AutonomyRetryPolicy,
} from "../../contracts/autonomy.js";
import type { GovRisk } from "../../contracts/security-governance.js";

export const ACTIONS: AutonomousAction[] = [
  {
    actionId: "read_repository",
    label: "Read repository",
    kind: "READ",
    risk: "LOW",
    restricted: false,
    idempotent: true,
    impact: "Reads repository metadata through the Integration Hub.",
  },
  {
    actionId: "inspect_logs",
    label: "Inspect logs",
    kind: "READ",
    risk: "LOW",
    restricted: false,
    idempotent: true,
    impact: "Reads the platform's own activity and governance records.",
  },
  {
    actionId: "generate_report",
    label: "Generate report",
    kind: "REPORT",
    risk: "LOW",
    restricted: false,
    idempotent: true,
    impact: "Writes a report into the workflow record.",
  },
  {
    actionId: "run_tests",
    label: "Run tests",
    kind: "TEST",
    risk: "LOW",
    restricted: false,
    idempotent: true,
    impact: "Runs the project's tests in the governed workspace.",
  },
  {
    actionId: "analyze_dependencies",
    label: "Analyse dependencies",
    kind: "ANALYZE",
    risk: "LOW",
    restricted: false,
    idempotent: true,
    impact: "Reads dependency manifests and reports updates.",
  },
  {
    actionId: "create_branch",
    label: "Create branch",
    kind: "BRANCH",
    risk: "MEDIUM",
    restricted: false,
    idempotent: false,
    rollbackAction: "delete_branch",
    impact: "Creates a branch in the project repository.",
  },
  {
    actionId: "prepare_pull_request",
    label: "Prepare pull request",
    kind: "PULL_REQUEST",
    risk: "MEDIUM",
    restricted: false,
    idempotent: false,
    impact: "Opens a pull request for review; nothing is merged.",
  },
  {
    actionId: "start_orchestrated_run",
    label: "Start an orchestrated run",
    kind: "ORCHESTRATE",
    risk: "MEDIUM",
    restricted: false,
    idempotent: false,
    impact:
      "Hands the objective to Prompt Intelligence and the execution orchestrator.",
  },
  {
    actionId: "commit_to_branch",
    label: "Commit to a feature branch",
    kind: "COMMIT",
    risk: "HIGH",
    restricted: false,
    idempotent: false,
    rollbackAction: "revert_commit",
    impact: "Adds a commit to a feature branch.",
  },
  {
    actionId: "push_branch",
    label: "Push a feature branch",
    kind: "PUSH",
    risk: "HIGH",
    restricted: false,
    idempotent: false,
    impact: "Publishes a feature branch to the remote.",
  },
  {
    actionId: "deploy_staging",
    label: "Deploy to staging",
    kind: "DEPLOY",
    risk: "HIGH",
    restricted: false,
    idempotent: false,
    rollbackAction: "rollback_deployment",
    impact: "Deploys the build to the staging environment.",
  },
  // reversal actions (only reachable through rollback)
  {
    actionId: "delete_branch",
    label: "Delete a feature branch",
    kind: "DELETE",
    risk: "HIGH",
    restricted: true,
    idempotent: true,
    impact: "Deletes a branch that this workflow created.",
  },
  {
    actionId: "revert_commit",
    label: "Revert a commit",
    kind: "COMMIT",
    risk: "HIGH",
    restricted: true,
    idempotent: false,
    impact: "Adds a revert commit.",
  },
  {
    actionId: "rollback_deployment",
    label: "Roll back a deployment",
    kind: "DEPLOY",
    risk: "HIGH",
    restricted: true,
    idempotent: true,
    impact: "Restores the previous release.",
  },
  // restricted: always the owner's explicit approval
  {
    actionId: "merge_production",
    label: "Merge to production",
    kind: "MERGE",
    risk: "CRITICAL",
    restricted: true,
    idempotent: false,
    rollbackAction: "revert_commit",
    impact: "Merges code into the production branch.",
  },
  {
    actionId: "deploy_production",
    label: "Deploy to production",
    kind: "DEPLOY",
    risk: "CRITICAL",
    restricted: true,
    idempotent: false,
    rollbackAction: "rollback_deployment",
    impact: "Deploys to the live production environment.",
  },
  {
    actionId: "delete_repository",
    label: "Delete a repository",
    kind: "DELETE",
    risk: "CRITICAL",
    restricted: true,
    idempotent: false,
    impact: "Permanently deletes a repository. Not reversible.",
  },
  {
    actionId: "delete_database",
    label: "Delete a database",
    kind: "DELETE",
    risk: "CRITICAL",
    restricted: true,
    idempotent: false,
    impact: "Permanently deletes data. Not reversible.",
  },
  {
    actionId: "modify_secrets",
    label: "Modify secrets",
    kind: "SECRETS",
    risk: "CRITICAL",
    restricted: true,
    idempotent: false,
    impact: "Changes credentials or secret configuration.",
  },
  {
    actionId: "destroy_infrastructure",
    label: "Destroy infrastructure",
    kind: "INFRASTRUCTURE",
    risk: "CRITICAL",
    restricted: true,
    idempotent: false,
    impact: "Destroys cloud infrastructure. Not reversible.",
  },
  {
    actionId: "send_external_communication",
    label: "Send external communication",
    kind: "EXTERNAL_COMMUNICATION",
    risk: "HIGH",
    restricted: true,
    idempotent: false,
    impact:
      "Sends a message to someone outside the platform. Cannot be recalled.",
  },
  {
    actionId: "destructive_device_action",
    label: "Destructive device action",
    kind: "DEVICE",
    risk: "CRITICAL",
    restricted: true,
    idempotent: false,
    impact: "Wipes, resets or removes a managed device.",
  },
];

const BY_ID = new Map(ACTIONS.map((a) => [a.actionId, a]));
export const actionOf = (actionId: string): AutonomousAction | undefined =>
  BY_ID.get(actionId);
/** Unknown actions are treated as the worst case. */
export const UNKNOWN_ACTION: AutonomousAction = {
  actionId: "unknown",
  label: "Unknown action",
  kind: "DELETE",
  risk: "CRITICAL",
  restricted: true,
  idempotent: false,
  impact: "Not in the action catalogue; treated as CRITICAL.",
};

export const RISK_ORDER: Record<GovRisk, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};
export const maxRisk = (a: GovRisk, b: GovRisk): GovRisk =>
  RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;

export const DEFAULT_RETRY: AutonomyRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 2000,
  retryOn: ["TRANSIENT"],
};

export type StepDecision =
  | { outcome: "AUTO"; reason: string }
  | { outcome: "NEEDS_APPROVAL"; reason: string }
  | { outcome: "REFUSED"; reason: string };

/**
 * Decide whether a step may run without the owner. The level only ever affects LOW/MEDIUM steps;
 * HIGH, CRITICAL and restricted actions always need explicit approval.
 */
export function decideStep(input: {
  action: AutonomousAction;
  risk: GovRisk;
  level: OpsAutonomyLevel;
  planApproved: boolean;
  boundaries: AutonomousWorkflowDef["boundaries"];
  /** The owner started this workflow by hand (vs. a trigger). */
  startedByOwner: boolean;
}): StepDecision {
  const { action, risk, level, planApproved, boundaries } = input;
  if (!boundaries.allowedActions.includes(action.actionId))
    return {
      outcome: "REFUSED",
      reason: `"${action.actionId}" is outside this workflow's boundaries`,
    };
  if (RISK_ORDER[risk] > RISK_ORDER[boundaries.maxRisk] && !action.restricted)
    return {
      outcome: "NEEDS_APPROVAL",
      reason: `${risk} risk exceeds this workflow's automatic limit (${boundaries.maxRisk})`,
    };
  if (action.restricted)
    return {
      outcome: "NEEDS_APPROVAL",
      reason: "restricted action: explicit approval is always required",
    };
  if (risk === "HIGH" || risk === "CRITICAL")
    return {
      outcome: "NEEDS_APPROVAL",
      reason: `${risk} risk requires the owner's approval`,
    };
  if (level === 0)
    return {
      outcome: "NEEDS_APPROVAL",
      reason: "autonomy level 0 (Manual): every step needs approval",
    };
  const inspect =
    action.kind === "READ" ||
    action.kind === "ANALYZE" ||
    action.kind === "REPORT"; // a report only writes into the workflow record
  if (risk === "LOW") {
    if (level === 1)
      return inspect
        ? { outcome: "AUTO", reason: "level 1 permits read-only inspection" }
        : {
            outcome: "NEEDS_APPROVAL",
            reason: "level 1 permits only read-only inspection",
          };
    return { outcome: "AUTO", reason: "LOW risk at level ≥ 2" };
  }
  // MEDIUM
  if (level >= 4)
    return {
      outcome: "AUTO",
      reason: "MEDIUM risk inside the boundaries at level ≥ 4",
    };
  if (level === 3 && planApproved)
    return {
      outcome: "AUTO",
      reason: "MEDIUM risk with an approved plan at level 3",
    };
  return {
    outcome: "NEEDS_APPROVAL",
    reason:
      level === 3
        ? "level 3 needs the plan approved first"
        : "MEDIUM risk needs approval below level 3",
  };
}

export const BUILTIN_DEFINITIONS: Omit<
  AutonomousWorkflowDef,
  "createdAt" | "createdBy" | "id"
>[] = [
  {
    definitionId: "wf-maintenance-check",
    name: "Maintenance check",
    description:
      "Inspect logs, run tests and report. Read-only apart from the report.",
    steps: [
      {
        stepId: "logs",
        actionId: "inspect_logs",
        description: "Inspect recent platform activity",
      },
      {
        stepId: "tests",
        actionId: "run_tests",
        description: "Run the project's tests",
      },
      {
        stepId: "report",
        actionId: "generate_report",
        description: "Summarise the findings",
      },
    ],
    boundaries: {
      allowedActions: [
        "inspect_logs",
        "run_tests",
        "generate_report",
        "analyze_dependencies",
      ],
      maxRisk: "LOW",
    },
    retry: DEFAULT_RETRY,
    builtin: true,
  },
  {
    definitionId: "wf-issue-triage",
    name: "Issue triage",
    description:
      "Read the repository and prepare a triage report for a new issue.",
    steps: [
      {
        stepId: "read",
        actionId: "read_repository",
        description: "Read repository context",
      },
      {
        stepId: "report",
        actionId: "generate_report",
        description: "Prepare the triage report",
      },
    ],
    boundaries: {
      allowedActions: ["read_repository", "generate_report"],
      maxRisk: "LOW",
    },
    retry: DEFAULT_RETRY,
    builtin: true,
  },
  {
    definitionId: "wf-dev-loop",
    name: "Autonomous development loop (to pull request)",
    description:
      "Analyse, hand the work to the orchestrated pipeline, then prepare a pull request. Merging and deploying are never part of this workflow.",
    steps: [
      {
        stepId: "analyze",
        actionId: "read_repository",
        description: "Analyse the request against the repository",
      },
      {
        stepId: "plan",
        actionId: "generate_report",
        description: "Write the plan",
      },
      {
        stepId: "run",
        actionId: "start_orchestrated_run",
        description:
          "Code, test, review and security-check through the orchestrated pipeline",
      },
      {
        stepId: "branch",
        actionId: "create_branch",
        description: "Create a feature branch",
      },
      {
        stepId: "pr",
        actionId: "prepare_pull_request",
        description: "Prepare the pull request for review",
      },
    ],
    boundaries: {
      allowedActions: [
        "read_repository",
        "generate_report",
        "start_orchestrated_run",
        "create_branch",
        "prepare_pull_request",
      ],
      maxRisk: "MEDIUM",
    },
    retry: DEFAULT_RETRY,
    builtin: true,
  },
  {
    definitionId: "wf-dependency-update",
    name: "Dependency update proposal",
    description:
      "Find outdated dependencies, test, and prepare a pull request. Never merges or deploys.",
    steps: [
      {
        stepId: "analyze",
        actionId: "analyze_dependencies",
        description: "Find outdated or vulnerable dependencies",
      },
      { stepId: "tests", actionId: "run_tests", description: "Run the tests" },
      {
        stepId: "branch",
        actionId: "create_branch",
        description: "Create a branch for the update",
      },
      {
        stepId: "pr",
        actionId: "prepare_pull_request",
        description: "Prepare the pull request",
      },
    ],
    boundaries: {
      allowedActions: [
        "analyze_dependencies",
        "run_tests",
        "create_branch",
        "prepare_pull_request",
      ],
      maxRisk: "MEDIUM",
    },
    retry: DEFAULT_RETRY,
    builtin: true,
  },
];
