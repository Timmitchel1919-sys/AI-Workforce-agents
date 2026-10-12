/**
 * Extension Platform registry: registration, versioning, dependency validation, permission
 * grants (deny by default), activation, health and audit.
 *
 * Nothing here executes extension code. Enabling an extension only changes what the platform
 * KNOWS (a skill in a briefing, a tool in the trust catalogue, a workflow template); everything
 * that acts still goes through the existing gateways and the Layer 7 governor.
 */
import { type DependencyCheck, type DependencyKind, type ExtensionAuditEvent, type ExtensionHealth, type ExtensionManifest, type ExtensionRecord, type ExtensionView, type SkillSpec, type ValidationFinding } from "../../contracts/extension-platform.js";
import type { Repository } from "../../contracts/persistence.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";
import type { TrustRegistry } from "../security-governance/trust-registry.js";
export type ExtensionErrorCode = "invalid_request" | "not_found" | "invalid_state" | "forbidden" | "conflict";
export declare class ExtensionError extends Error {
    readonly code: ExtensionErrorCode;
    readonly findings?: ValidationFinding[] | undefined;
    constructor(code: ExtensionErrorCode, message: string, findings?: ValidationFinding[] | undefined);
}
/** Resolves non-extension dependencies (connectors, models, tools, libraries, environments). */
export interface ExternalDependencyResolver {
    check(kind: DependencyKind, id: string, range?: string): {
        ok: boolean;
        reason: string;
    };
}
export interface ExtensionRepos {
    extensions: Repository<ExtensionRecord>;
    audit: Repository<ExtensionAuditEvent>;
}
export declare class ExtensionPlatform {
    private readonly deps;
    private readonly extensions;
    private readonly auditRepo;
    private seq;
    constructor(repos: ExtensionRepos, deps: {
        ledger: GovernanceLedger;
        trust?: TrustRegistry;
        external?: ExternalDependencyResolver;
        platformVersion: string;
        clock: () => string;
    });
    record(id: string): ExtensionRecord | undefined;
    private require;
    private manifestOf;
    list(): ExtensionView[];
    get(id: string): ExtensionView;
    audit(extensionId?: string, limit?: number): ExtensionAuditEvent[];
    /** Enabled extensions that depend on `id` (by extension dependency). */
    dependentsOf(id: string): {
        extensionId: string;
        range?: string;
    }[];
    checkDependencies(m: ExtensionManifest): DependencyCheck[];
    private platformCompatible;
    private grantsFor;
    health(r: ExtensionRecord): {
        health: ExtensionHealth;
        reason: string;
    };
    private lifecycle;
    private view;
    register(input: unknown, by: string, source?: "builtin" | "user"): ExtensionView;
    registerVersion(input: unknown, by: string): ExtensionView;
    test(id: string, by: string, version?: string): ExtensionView;
    /** Deterministic security review. High-risk requests need an explicit human approval. */
    review(id: string, by: string, version?: string): ExtensionView;
    approveReview(id: string, by: string, version?: string): ExtensionView;
    grant(id: string, scope: string, by: string): ExtensionView;
    revoke(id: string, scope: string, by: string): ExtensionView;
    /**
     * The single runtime permission check. Deny by default: the extension must be ENABLED, the
     * ACTIVE version must have requested the scope, and the owner must have granted it.
     */
    authorize(id: string, scope: string): {
        allowed: boolean;
        reason: string;
    };
    /**
     * Enable (or switch to) a version. Refuses unless it passed its test and security review, its
     * dependencies are satisfied and it is platform-compatible. Switching versions also checks
     * compatibility with the active one and with the extensions that depend on this one.
     */
    enable(id: string, by: string, opts?: {
        version?: string;
        acknowledgeBreaking?: boolean;
    }): ExtensionView;
    rollback(id: string, toVersion: string, by: string): ExtensionView;
    disable(id: string, by: string): ExtensionView;
    remove(id: string, by: string): void;
    configure(id: string, config: Record<string, unknown>, by: string): ExtensionView;
    /** Enabled skills relevant to a task, for the execution prompt briefing. */
    skillsFor(input: {
        taskType?: string;
        text?: string;
        limit?: number;
    }): {
        extensionId: string;
        name: string;
        version: string;
        spec: SkillSpec;
    }[];
    enabledWorkflowTemplates(): {
        extensionId: string;
        name: string;
        version: string;
        stages: import("../../contracts/extension-platform.js").WorkflowStage[];
    }[];
    enabledAgents(): {
        extensionId: string;
        name: string;
        version: string;
        spec: import("../../contracts/extension-platform.js").AgentSpec;
    }[];
    breakingChanges(from: ExtensionManifest, to: ExtensionManifest): string[];
    private applyEffect;
    private versionOf;
    private replaceVersion;
    private save;
    private log;
}
