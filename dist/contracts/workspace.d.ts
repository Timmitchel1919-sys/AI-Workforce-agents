import type { SecretReference } from "./execution.js";
import type { SourceFingerprint } from "./verification.js";
export declare const WORKSPACE_STATES: readonly ["preparing", "ready", "in_use", "dirty", "cleaning", "closed", "failed"];
export type WorkspaceState = (typeof WORKSPACE_STATES)[number];
export declare const WORKSPACE_TRANSITIONS: Readonly<Record<WorkspaceState, readonly WorkspaceState[]>>;
export declare function canTransitionWorkspace(from: WorkspaceState, to: WorkspaceState): boolean;
/**
 * A project's repository, as configured by trusted composition (never by a
 * request or a model). `localPath` is a host path known only to the
 * workspace adapter. A private remote is described by a URL plus a SECRET
 * REFERENCE — never a token — and is acquired only through a secret broker.
 */
export interface RepositoryReference {
    repositoryId: string;
    projectId: string;
    /** Attached working tree on the execution host (trusted config). */
    localPath?: string;
    remote?: {
        url: string;
        /** Credential reference for a private repository; value never stored. */
        credentialRef?: SecretReference;
    };
    defaultBranch?: string;
}
export declare function validateRepositoryReference(ref: RepositoryReference): void;
/** Safe, agent/API-visible view of a repository (no path, no credential). */
export interface RepositoryView {
    repositoryId: string;
    projectId: string;
    kind: "attached" | "remote";
    private: boolean;
    defaultBranch?: string;
}
export declare function repositoryView(ref: RepositoryReference): RepositoryView;
/** Workspace metadata as exposed outside the adapter: no host path. */
export interface ManagedWorkspaceView {
    workspaceId: string;
    projectId: string;
    sessionId: string;
    repositoryId: string;
    rootRef: string;
    mode: "read_only" | "read_write";
    state: WorkspaceState;
    createdAt: string;
    leaseExpiresAt?: string;
    baseRevision?: string;
}
export type FileChangeKind = "created" | "modified" | "deleted" | "renamed";
/** Evidence of one mutation — hashes and sizes, never content. */
export interface FileChangeEvidence {
    path: string;
    change: FileChangeKind;
    fromPath?: string;
    beforeHash?: string;
    afterHash?: string;
    sizeDelta: number;
    risk: "normal" | "protected";
}
export declare const CHANGESET_STATUSES: readonly ["open", "ready_for_review", "rolled_back", "abandoned", "verifying", "verified", "verification_failed"];
export type ChangeSetStatus = (typeof CHANGESET_STATUSES)[number];
/**
 * AI Workforce's record of the workspace mutations ONE session made.
 * A ChangeSet is NOT a Git commit; review, test, approval and commit are
 * later, separate stages.
 */
export interface ChangeSet {
    changeSetId: string;
    projectId: string;
    workspaceId: string;
    sessionId: string;
    baseRevision?: string;
    /** Paths that were already modified/untracked before the session. */
    baseline: readonly string[];
    entries: readonly FileChangeEvidence[];
    status: ChangeSetStatus;
    updatedAt: string;
}
export interface RollbackReport {
    changeSetId: string;
    reverted: readonly string[];
    /** Paths changed by someone else since the session wrote them: untouched. */
    skipped: readonly {
        path: string;
        reason: string;
    }[];
}
export interface WorkspaceCleanupReport {
    workspaceId: string;
    released: boolean;
    removedState: boolean;
    /** Cleanup fails closed: when ownership cannot be proven nothing is deleted. */
    failure?: string;
}
/**
 * Operator-level workspace control, implemented by the workspace adapter and
 * reached only through the ExecutionManager (authorized, audited).
 */
export interface WorkspaceControl {
    changeSet(workspaceId: string): ChangeSet | undefined;
    workspace(workspaceId: string): ManagedWorkspaceView | undefined;
    rollback(workspaceId: string, sessionId: string): Promise<RollbackReport>;
    release(workspaceId: string, sessionId: string): Promise<WorkspaceCleanupReport>;
    /** Deterministic fingerprint of the project's current source state. */
    sourceFingerprint?(projectId: string): Promise<SourceFingerprint>;
    /** SHA-256 + size of a workspace-relative file (artifact integrity). */
    digestFile?(projectId: string, path: string): Promise<{
        sha256: string;
        size: number;
    }>;
    /** Record a verification status on a session ChangeSet. */
    setChangeSetStatus?(workspaceId: string, status: ChangeSetStatus): void;
}
export type WorkspacePathClass = "internal" | "secret" | "protected" | "generated" | "normal";
/**
 * Per-project workspace file policy. Pattern syntax: `*` matches within a
 * segment, `**` across segments; matching is case-insensitive (Windows-safe).
 * Classification is AUTHORITATIVE system policy — a request cannot lower it.
 */
export interface WorkspaceFilePolicy {
    maxReadBytes: number;
    maxWriteBytes: number;
    maxListEntries: number;
    maxSearchResults: number;
    maxSearchFiles: number;
    maxSearchFileBytes: number;
    maxChangedFiles: number;
    /** Never readable or writable by agents (credentials, keys, env files). */
    secretPatterns: readonly string[];
    /** Writable only with `filesystem.write.protected` (CI/CD, rules, infra). */
    protectedPatterns: readonly string[];
    /** Build output / caches: not source; agents do not write here. */
    generatedPatterns: readonly string[];
}
export declare const DEFAULT_WORKSPACE_FILE_POLICY: WorkspaceFilePolicy;
/** Classify a CANONICAL workspace-relative path under a policy. */
export declare function classifyWorkspacePath(path: string, policy: WorkspaceFilePolicy): WorkspacePathClass;
