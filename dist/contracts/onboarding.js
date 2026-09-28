/* ------------------------------------------------------------------ */
/* Enumerations                                                       */
/* ------------------------------------------------------------------ */
export const ONBOARDING_MODES = ["guided", "auto"];
export const ONBOARDING_KINDS = [
    "create_new",
    "import_existing",
    "import_local",
];
/**
 * Source providers. Only providers with `available: true` may be selected;
 * the rest are declared so the contract is future-extensible without faking
 * an integration that does not exist.
 */
export const SOURCE_PROVIDERS = [
    "github",
    "gitlab",
    "bitbucket",
    "azure_devops",
    "local_workspace",
    "source_bundle",
    "template",
    "existing_project",
];
export const ONBOARDING_STATUSES = [
    "draft",
    "source_configured",
    "analyzing",
    "analyzed",
    "planning",
    "review_required",
    "approved",
    "provisioning",
    "validating",
    "ready",
    "analysis_failed",
    "provisioning_failed",
    "validation_failed",
    "cancelled",
];
/**
 * The deterministic lifecycle. A failure state is explicit and recoverable
 * where it is safe: analysis may be retried, provisioning may be resumed,
 * validation may be re-run. `ready` and `cancelled` are terminal.
 */
export const ONBOARDING_TRANSITIONS = Object.freeze({
    draft: ["draft", "source_configured", "cancelled"],
    source_configured: ["draft", "source_configured", "analyzing", "cancelled"],
    analyzing: ["analyzed", "analysis_failed", "cancelled"],
    analyzed: [
        "draft",
        "source_configured",
        "planning",
        "analyzing",
        "cancelled",
    ],
    planning: ["review_required", "analyzed", "cancelled"],
    review_required: [
        "review_required",
        "approved",
        "draft",
        "source_configured",
        "analyzed",
        "planning",
        "cancelled",
    ],
    approved: [
        "provisioning",
        "review_required",
        "draft",
        "source_configured",
        "analyzed",
        "cancelled",
    ],
    provisioning: ["validating", "provisioning_failed"],
    validating: ["ready", "validation_failed"],
    ready: [],
    analysis_failed: ["draft", "source_configured", "analyzing", "cancelled"],
    provisioning_failed: ["provisioning", "cancelled"],
    validation_failed: ["validating", "provisioning", "cancelled"],
    cancelled: [],
});
export function canTransitionOnboarding(from, to) {
    return ONBOARDING_TRANSITIONS[from].includes(to);
}
/** Statuses in which the draft (identity/source/overrides) may still change. */
export const EDITABLE_ONBOARDING_STATUSES = [
    "draft",
    "source_configured",
    "analyzed",
    "analysis_failed",
    "review_required",
];
export const TERMINAL_ONBOARDING_STATUSES = [
    "ready",
    "cancelled",
];
/* ------------------------------------------------------------------ */
/* Draft input                                                        */
/* ------------------------------------------------------------------ */
export const PROJECT_PRIORITIES = [
    "low",
    "normal",
    "high",
    "critical",
];
export const ENV_VAR_CLASSES = [
    "public_client",
    "server_secret",
    "build_secret",
    "runtime_secret",
    "unclassified",
];
export const ANALYSIS_SEVERITIES = ["info", "warning", "blocker"];
/* ------------------------------------------------------------------ */
/* Provisioning plan                                                  */
/* ------------------------------------------------------------------ */
export const AUTONOMY_LEVELS = [1, 2, 3, 4, 5];
/**
 * Capabilities are authoritative; the numeric level only selects a preset
 * that is intersected with what the platform actually allows. A level is
 * never a security bypass.
 */
export const PROJECT_CAPABILITIES = [
    "repository.read",
    "repository.write",
    "branch.create",
    "tests.run",
    "commit.create",
    "push",
    "pull_request.create",
    "merge",
    "deployment.staging",
    "deployment.production",
];
export const PIPELINE_STAGES = [
    "install",
    "typecheck",
    "lint",
    "test",
    "build",
    "security",
    "smoke",
];
export const INTEGRATION_STATES = [
    "connected",
    "required",
    "optional",
    "unavailable",
    "needs_authorization",
];
export const PLANNED_STEP_KEYS = [
    "registry_entry",
    "repository_binding",
    "repository_creation",
    "environment_profile",
    "agent_policy",
    "integration_policies",
    "secret_requirements",
    "git_workflow",
    "build_test_pipeline",
    "deployment_configuration",
    "firebase_provisioning",
    "cost_policy",
    "audit_baseline",
    "project_knowledge",
];
/* ------------------------------------------------------------------ */
/* Provisioning run + validation                                      */
/* ------------------------------------------------------------------ */
export const STEP_STATUSES = [
    "pending",
    "running",
    "complete",
    "failed",
    "skipped",
    /** Declared but not executable here (e.g. repository creation). */
    "requirement_pending",
];
export const UNAVAILABLE = "Unavailable — not established";
export const ONBOARDING_COMMANDS = [
    "onboarding_create",
    "onboarding_update",
    "onboarding_analyze",
    "onboarding_plan",
    "onboarding_approve_plan",
    "onboarding_provision",
    "onboarding_revalidate",
    "onboarding_cancel",
];
export const PROJECT_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,11}$/;
export const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
