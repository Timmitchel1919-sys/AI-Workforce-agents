export const EXTENSION_TYPES = [
    "SKILL",
    "AGENT",
    "TOOL",
    "CONNECTOR",
    "WORKFLOW",
    "COMMAND",
    "MODEL_PROVIDER",
    "UI_EXTENSION",
    "KNOWLEDGE_SOURCE",
];
/**
 * What enabling an extension of this type actually does today. The registry accepts every
 * type so the architecture can grow, but only some types have a runtime effect.
 */
export const EXTENSION_TYPE_SUPPORT = {
    SKILL: {
        level: "ACTIVE",
        effect: "Enabled skills are added to the execution prompt briefing for matching tasks.",
    },
    AGENT: {
        level: "ACTIVE",
        effect: "Enabled agent descriptors are available to planning and routing recommendations; they are not executable agents.",
    },
    TOOL: {
        level: "ACTIVE",
        effect: "Enabling registers the tool in the governance tool-trust catalogue (REVIEW_REQUIRED until trusted); execution stays on the backing capability through the Tool Gateway.",
    },
    WORKFLOW: {
        level: "ACTIVE",
        effect: "Enabled workflow templates can be used by the Business and Autonomous Operations layers to build plans.",
    },
    CONNECTOR: {
        level: "REGISTRY_ONLY",
        effect: "Recorded and governed only. Connectors are installed through the Integration Hub.",
    },
    COMMAND: {
        level: "REGISTRY_ONLY",
        effect: "Recorded only; no command runtime exists.",
    },
    MODEL_PROVIDER: {
        level: "REGISTRY_ONLY",
        effect: "Recorded only; model selection stays with the Model Router.",
    },
    UI_EXTENSION: {
        level: "REGISTRY_ONLY",
        effect: "Recorded only; the UI does not load third-party views.",
    },
    KNOWLEDGE_SOURCE: {
        level: "REGISTRY_ONLY",
        effect: "Recorded only; knowledge ingestion stays in the Knowledge layer.",
    },
};
/** Scopes an extension may REQUEST. Nothing is granted automatically. */
export const EXTENSION_PERMISSION_CATALOG = [
    {
        scope: "workspace.read",
        risk: "LOW",
        description: "Read files of the project workspace",
        grantable: true,
    },
    {
        scope: "workspace.write",
        risk: "HIGH",
        description: "Modify files of the project workspace",
        grantable: true,
    },
    {
        scope: "github.read",
        risk: "LOW",
        description: "Read repositories, issues and pull requests",
        grantable: true,
    },
    {
        scope: "github.write",
        risk: "HIGH",
        description: "Create branches, commits, pull requests and issues",
        grantable: true,
    },
    {
        scope: "firebase.read",
        risk: "LOW",
        description: "Inspect Firebase projects",
        grantable: true,
    },
    {
        scope: "firebase.deploy",
        risk: "CRITICAL",
        description: "Deploy to Firebase",
        grantable: true,
    },
    {
        scope: "database.read",
        risk: "MEDIUM",
        description: "Read project databases",
        grantable: true,
    },
    {
        scope: "database.write",
        risk: "CRITICAL",
        description: "Modify project databases",
        grantable: true,
    },
    {
        scope: "email.draft",
        risk: "LOW",
        description: "Draft email",
        grantable: true,
    },
    {
        scope: "email.send",
        risk: "CRITICAL",
        description: "Send email",
        grantable: true,
    },
    {
        scope: "calendar.read",
        risk: "LOW",
        description: "Read calendars",
        grantable: true,
    },
    {
        scope: "external_api",
        risk: "HIGH",
        description: "Call an external API through the Integration Hub",
        grantable: true,
    },
    {
        scope: "knowledge.read",
        risk: "LOW",
        description: "Read project knowledge",
        grantable: true,
    },
    {
        scope: "knowledge.write",
        risk: "MEDIUM",
        description: "Propose project knowledge",
        grantable: true,
    },
    {
        scope: "secrets.read",
        risk: "CRITICAL",
        description: "Read secrets or credentials",
        grantable: false,
    },
    {
        scope: "secrets.write",
        risk: "CRITICAL",
        description: "Create or change secrets",
        grantable: false,
    },
    {
        scope: "os.core",
        risk: "CRITICAL",
        description: "Modify the platform core",
        grantable: false,
    },
];
export const DEPENDENCY_KINDS = [
    "extension",
    "connector",
    "model",
    "tool",
    "library",
    "environment",
];
export const EXTENSION_STATUSES = [
    "REGISTERED",
    "ENABLED",
    "DISABLED",
    "FAILED",
    "REMOVED",
];
export const EXTENSION_HEALTH = [
    "INSTALLED",
    "ACTIVE",
    "DISABLED",
    "INCOMPATIBLE",
    "FAILED",
    "UPDATE_AVAILABLE",
];
export const LIFECYCLE_STEPS = [
    "CREATE",
    "DEFINE_CAPABILITY",
    "DEFINE_TOOLS",
    "DEFINE_PERMISSIONS",
    "TEST",
    "SECURITY_REVIEW",
    "REGISTER",
    "ENABLE",
    "MONITOR",
];
export const EXTENSION_COMMANDS = [
    "extension_register",
    "extension_register_version",
    "extension_test",
    "extension_review",
    "extension_approve_review",
    "extension_grant_permission",
    "extension_revoke_permission",
    "extension_enable",
    "extension_disable",
    "extension_rollback",
    "extension_configure",
    "extension_remove",
];
export const EXTENSION_LIMITS = {
    manifestBytes: 64_000,
    capabilities: 50,
    dependencies: 30,
    versions: 50,
    stages: 30,
    listItems: 40,
    textField: 4000,
};
