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
export declare const EXTENSION_TYPES: readonly ["SKILL", "AGENT", "TOOL", "CONNECTOR", "WORKFLOW", "COMMAND", "MODEL_PROVIDER", "UI_EXTENSION", "KNOWLEDGE_SOURCE"];
export type ExtensionType = (typeof EXTENSION_TYPES)[number];
/**
 * What enabling an extension of this type actually does today. The registry accepts every
 * type so the architecture can grow, but only some types have a runtime effect.
 */
export declare const EXTENSION_TYPE_SUPPORT: Record<ExtensionType, {
    level: "ACTIVE" | "REGISTRY_ONLY";
    effect: string;
}>;
/** Scopes an extension may REQUEST. Nothing is granted automatically. */
export declare const EXTENSION_PERMISSION_CATALOG: readonly {
    scope: string;
    risk: GovRisk;
    description: string;
    /** false = can be requested in a manifest but is never grantable. */
    grantable: boolean;
}[];
export declare const DEPENDENCY_KINDS: readonly ["extension", "connector", "model", "tool", "library", "environment"];
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
    appliesTo?: {
        taskTypes?: string[];
        keywords?: string[];
    };
}
export interface AgentSpec {
    agentId: string;
    role: string;
    capabilities: string[];
    modelRequirements: {
        capabilities?: string[];
        minContextTokens?: number;
    };
    tools: string[];
    inputContract: string;
    outputContract: string;
    validation: string[];
    costProfile: {
        tier: "low" | "medium" | "high";
        maxTokensPerTask?: number;
    };
}
export interface SchemaLite {
    type: "object";
    properties: Record<string, {
        type: "string" | "number" | "boolean" | "array" | "object";
        description?: string;
    }>;
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
    audit: {
        logInputs: boolean;
        logOutputs: boolean;
    };
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
    compatibility?: {
        platform?: string;
    };
    configSchema?: Record<string, {
        type: "string" | "number" | "boolean";
        description?: string;
        default?: string | number | boolean;
    }>;
    spec: SkillSpec | AgentSpec | ToolSpec | WorkflowSpec | Record<string, unknown>;
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
    test?: {
        passed: boolean;
        at: string;
        findings: ValidationFinding[];
    };
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
export declare const EXTENSION_STATUSES: readonly ["REGISTERED", "ENABLED", "DISABLED", "FAILED", "REMOVED"];
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];
export declare const EXTENSION_HEALTH: readonly ["INSTALLED", "ACTIVE", "DISABLED", "INCOMPATIBLE", "FAILED", "UPDATE_AVAILABLE"];
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
    action: "registered" | "version_registered" | "tested" | "reviewed" | "review_approved" | "permission_granted" | "permission_revoked" | "enabled" | "disabled" | "updated" | "rolled_back" | "configured" | "removed" | "enable_refused";
    version?: string;
    detail: string;
}
export interface DependencyCheck {
    dependency: ExtensionDependency;
    satisfied: boolean;
    reason: string;
}
export declare const LIFECYCLE_STEPS: readonly ["CREATE", "DEFINE_CAPABILITY", "DEFINE_TOOLS", "DEFINE_PERMISSIONS", "TEST", "SECURITY_REVIEW", "REGISTER", "ENABLE", "MONITOR"];
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
export declare const EXTENSION_COMMANDS: readonly ["extension_register", "extension_register_version", "extension_test", "extension_review", "extension_approve_review", "extension_grant_permission", "extension_revoke_permission", "extension_enable", "extension_disable", "extension_rollback", "extension_configure", "extension_remove"];
export type ExtensionCommand = (typeof EXTENSION_COMMANDS)[number];
export declare const EXTENSION_LIMITS: {
    readonly manifestBytes: 64000;
    readonly capabilities: 50;
    readonly dependencies: 30;
    readonly versions: 50;
    readonly stages: 30;
    readonly listItems: 40;
    readonly textField: 4000;
};
