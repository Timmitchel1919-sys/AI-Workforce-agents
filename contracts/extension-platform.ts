/**
 * Layer 9 — Extension, Plugin & Developer Platform: contracts.
 *
 * An extension is DECLARATIVE data (a manifest). It never carries executable code:
 * a skill is instructions, an agent is a descriptor, a tool is a governed declaration
 * backed by an existing capability, a workflow is a stage template. Anything that acts on
 * the world still goes through the existing Tool Gateway, Model Router and Layer 7 governor.
 * The older `ExtensionDefinition`/`ExtensionInstallation` types in `extensions.ts` are
 * enterprise-marketplace stubs and are not used here.
 */
import type { Entity } from "./persistence.js";
import type { GovRisk } from "./security-governance.js";

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
] as const;
export type ExtensionType = (typeof EXTENSION_TYPES)[number];

/**
 * What enabling an extension of this type actually does today. The registry accepts every
 * type so the architecture can grow, but only some types have a runtime effect.
 */
export const EXTENSION_TYPE_SUPPORT: Record<
  ExtensionType,
  { level: "ACTIVE" | "REGISTRY_ONLY"; effect: string }
> = {
  SKILL: {
    level: "ACTIVE",
    effect:
      "Enabled skills are added to the execution prompt briefing for matching tasks.",
  },
  AGENT: {
    level: "ACTIVE",
    effect:
      "Enabled agent descriptors are available to planning and routing recommendations; they are not executable agents.",
  },
  TOOL: {
    level: "ACTIVE",
    effect:
      "Enabling registers the tool in the governance tool-trust catalogue (REVIEW_REQUIRED until trusted); execution stays on the backing capability through the Tool Gateway.",
  },
  WORKFLOW: {
    level: "ACTIVE",
    effect:
      "Enabled workflow templates can be used by the Business and Autonomous Operations layers to build plans.",
  },
  CONNECTOR: {
    level: "REGISTRY_ONLY",
    effect:
      "Recorded and governed only. Connectors are installed through the Integration Hub.",
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
export const EXTENSION_PERMISSION_CATALOG: readonly {
  scope: string;
  risk: GovRisk;
  description: string;
  /** false = can be requested in a manifest but is never grantable. */
  grantable: boolean;
}[] = [
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
] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export interface ExtensionDependency {
  kind: DependencyKind;
  id: string;
  /** "*", "1.2.3", "^1.2.0", "~1.2.0", ">=1.0.0" */
  range?: string;
}

export interface SkillSpec {
  capability: string;
  instructions: string;
  prerequisites: string[];
  tools: string[];
  expectedOutputs: string[];
  validation: string[];
  appliesTo?: { taskTypes?: string[]; keywords?: string[] };
}

export interface AgentSpec {
  agentId: string;
  role: string;
  capabilities: string[];
  modelRequirements: { capabilities?: string[]; minContextTokens?: number };
  tools: string[];
  inputContract: string;
  outputContract: string;
  validation: string[];
  costProfile: { tier: "low" | "medium" | "high"; maxTokensPerTask?: number };
}

export interface SchemaLite {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "array" | "object";
      description?: string;
    }
  >;
  required?: string[];
}

export interface ToolSpec {
  toolId: string;
  purpose: string;
  inputSchema: SchemaLite;
  outputSchema: SchemaLite;
  risk: GovRisk;
  authentication: "none" | "vault" | "oauth";
  environment: "gateway" | "sandbox" | "read_only";
  audit: { logInputs: boolean; logOutputs: boolean };
  /** The existing Tool Gateway capability that actually performs the work. */
  backingCapability?: string;
}

export interface WorkflowStage {
  id: string;
  title: string;
  taskType: string;
  agentRole?: string;
  requiresApproval?: boolean;
  dependsOn?: string[];
}
export interface WorkflowSpec {
  stages: WorkflowStage[];
}

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  type: ExtensionType;
  author: string;
  capabilities: string[];
  dependencies: ExtensionDependency[];
  /** Requested scopes (see the catalogue). */
  permissions: string[];
  compatibility?: { platform?: string };
  configSchema?: Record<
    string,
    {
      type: "string" | "number" | "boolean";
      description?: string;
      default?: string | number | boolean;
    }
  >;
  spec:
    SkillSpec | AgentSpec | ToolSpec | WorkflowSpec | Record<string, unknown>;
}

export interface ValidationFinding {
  level: "ERROR" | "WARNING";
  path: string;
  message: string;
}

export interface ExtensionVersionRecord {
  version: string;
  manifest: ExtensionManifest;
  registeredAt: string;
  registeredBy: string;
  test?: { passed: boolean; at: string; findings: ValidationFinding[] };
  review?: {
    outcome: "PASSED" | "NEEDS_APPROVAL" | "BLOCKED" | "APPROVED";
    at: string;
    findings: string[];
    approvedBy?: string;
  };
}

export interface PermissionGrant {
  scope: string;
  grantedBy: string;
  grantedAt: string;
  /** Re-granted automatically never: a new version that asks for more must be re-granted. */
  version: string;
}

export const EXTENSION_STATUSES = [
  "REGISTERED",
  "ENABLED",
  "DISABLED",
  "FAILED",
  "REMOVED",
] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

export const EXTENSION_HEALTH = [
  "INSTALLED",
  "ACTIVE",
  "DISABLED",
  "INCOMPATIBLE",
  "FAILED",
  "UPDATE_AVAILABLE",
] as const;
export type ExtensionHealth = (typeof EXTENSION_HEALTH)[number];

export interface ExtensionRecord extends Entity {
  extensionId: string;
  type: ExtensionType;
  name: string;
  description: string;
  source: "builtin" | "user";
  status: ExtensionStatus;
  /** The version in effect when ENABLED (or last enabled). */
  activeVersion?: string;
  latestVersion: string;
  versions: ExtensionVersionRecord[];
  grants: PermissionGrant[];
  config: Record<string, string | number | boolean>;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ExtensionAuditEvent extends Entity {
  at: string;
  actor: string;
  extensionId: string;
  action:
    | "registered"
    | "version_registered"
    | "tested"
    | "reviewed"
    | "review_approved"
    | "permission_granted"
    | "permission_revoked"
    | "enabled"
    | "disabled"
    | "updated"
    | "rolled_back"
    | "configured"
    | "removed"
    | "enable_refused";
  version?: string;
  detail: string;
}

export interface DependencyCheck {
  dependency: ExtensionDependency;
  satisfied: boolean;
  reason: string;
}

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
] as const;
export type LifecycleStep = (typeof LIFECYCLE_STEPS)[number];
export interface LifecycleView {
  step: LifecycleStep;
  status: "DONE" | "PENDING" | "NOT_APPLICABLE" | "BLOCKED";
  note?: string;
}

export interface ExtensionView {
  extensionId: string;
  type: ExtensionType;
  name: string;
  description: string;
  source: "builtin" | "user";
  status: ExtensionStatus;
  health: ExtensionHealth;
  healthReason: string;
  activeVersion?: string;
  latestVersion: string;
  versions: {
    version: string;
    registeredAt: string;
    tested: boolean | null;
    review: string | null;
  }[];
  requestedPermissions: string[];
  grantedPermissions: string[];
  missingGrants: string[];
  dependencies: DependencyCheck[];
  capabilities: string[];
  effect: string;
  supportLevel: "ACTIVE" | "REGISTRY_ONLY";
  lifecycle: LifecycleView[];
  config: Record<string, string | number | boolean>;
  updatedAt: string;
}

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
] as const;
export type ExtensionCommand = (typeof EXTENSION_COMMANDS)[number];

export const EXTENSION_LIMITS = {
  manifestBytes: 64_000,
  capabilities: 50,
  dependencies: 30,
  versions: 50,
  stages: 30,
  listItems: 40,
  textField: 4000,
} as const;
