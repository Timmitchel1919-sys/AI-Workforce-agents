/**
 * EO-4.3 — isolated workspace & repository contracts.
 *
 *   WORKSPACE ≠ HOST FILESYSTEM · FILE WRITE ≠ FILE DELETE ·
 *   REPOSITORY WRITE ≠ GIT COMMIT · GIT COMMIT ≠ GIT PUSH · BUILD ≠ DEPLOY
 *
 * Agents address files only by workspace-relative paths inside a workspace
 * bound to their session. Host paths, repository URLs and credentials never
 * appear in any agent-facing, API or receipt type here.
 */
import { ValidationError } from "./index.js";
import { requireExecutionId, validateSecretReference } from "./execution.js";
import type { SecretReference } from "./execution.js";
import type { SourceFingerprint } from "./verification.js";

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

export const WORKSPACE_STATES = [
  "preparing",
  "ready",
  "in_use",
  "dirty",
  "cleaning",
  "closed",
  "failed",
] as const;
export type WorkspaceState = (typeof WORKSPACE_STATES)[number];

export const WORKSPACE_TRANSITIONS: Readonly<
  Record<WorkspaceState, readonly WorkspaceState[]>
> = {
  preparing: ["ready", "failed"],
  ready: ["in_use", "cleaning", "failed"],
  in_use: ["ready", "dirty", "failed"],
  dirty: ["in_use", "cleaning", "failed"],
  cleaning: ["closed", "failed"],
  closed: [],
  failed: ["cleaning"],
};

export function canTransitionWorkspace(
  from: WorkspaceState,
  to: WorkspaceState,
): boolean {
  return WORKSPACE_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ */
/* Repository references (trusted configuration only)                 */
/* ------------------------------------------------------------------ */

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

export function validateRepositoryReference(ref: RepositoryReference): void {
  requireExecutionId(ref.repositoryId, "repository.repositoryId");
  requireExecutionId(ref.projectId, "repository.projectId");
  if (!ref.localPath && !ref.remote) {
    throw new ValidationError("repository needs a localPath or a remote");
  }
  if (ref.remote) {
    let url: URL;
    try {
      url = new URL(ref.remote.url);
    } catch {
      throw new ValidationError("repository.remote.url must be a URL");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new ValidationError(
        "repository.remote.url must be https without embedded credentials",
      );
    }
    if (ref.remote.credentialRef) {
      validateSecretReference(ref.remote.credentialRef, "credentialRef");
    }
  }
}

/** Safe, agent/API-visible view of a repository (no path, no credential). */
export interface RepositoryView {
  repositoryId: string;
  projectId: string;
  kind: "attached" | "remote";
  private: boolean;
  defaultBranch?: string;
}

export function repositoryView(ref: RepositoryReference): RepositoryView {
  return {
    repositoryId: ref.repositoryId,
    projectId: ref.projectId,
    kind: ref.localPath ? "attached" : "remote",
    private: Boolean(ref.remote?.credentialRef),
    ...(ref.defaultBranch ? { defaultBranch: ref.defaultBranch } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Managed workspace view                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Change tracking                                                    */
/* ------------------------------------------------------------------ */

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

export const CHANGESET_STATUSES = [
  "open",
  "ready_for_review",
  "rolled_back",
  "abandoned",
  // EO-4.4 — verification states. VERIFIED is not COMMITTED.
  "verifying",
  "verified",
  "verification_failed",
] as const;
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
  skipped: readonly { path: string; reason: string }[];
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
  release(
    workspaceId: string,
    sessionId: string,
  ): Promise<WorkspaceCleanupReport>;
  /* ---- EO-4.4 (trusted, server-side; never agent-reachable) ---- */
  /** Deterministic fingerprint of the project's current source state. */
  sourceFingerprint?(projectId: string): Promise<SourceFingerprint>;
  /** SHA-256 + size of a workspace-relative file (artifact integrity). */
  digestFile?(
    projectId: string,
    path: string,
  ): Promise<{ sha256: string; size: number }>;
  /** Record a verification status on a session ChangeSet. */
  setChangeSetStatus?(workspaceId: string, status: ChangeSetStatus): void;
}

/* ------------------------------------------------------------------ */
/* File policy                                                        */
/* ------------------------------------------------------------------ */

export type WorkspacePathClass =
  "internal" | "secret" | "protected" | "generated" | "normal";

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

export const DEFAULT_WORKSPACE_FILE_POLICY: WorkspaceFilePolicy = {
  maxReadBytes: 256 * 1024,
  maxWriteBytes: 256 * 1024,
  maxListEntries: 200,
  maxSearchResults: 50,
  maxSearchFiles: 2000,
  maxSearchFileBytes: 512 * 1024,
  maxChangedFiles: 100,
  secretPatterns: [
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/id_rsa*",
    "**/id_ed25519*",
    "**/.npmrc",
    "**/.netrc",
    "**/*service-account*.json",
    "**/credentials*.json",
    "**/.ssh/**",
    "**/secrets/**",
  ],
  protectedPatterns: [
    ".github/workflows/**",
    "**/firebase.json",
    "**/*.rules",
    "**/firestore.indexes.json",
    "infrastructure/**",
    "deploy/**",
    "**/Dockerfile",
    "**/auth/**",
    "**/package-lock.json",
  ],
  generatedPatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.cache/**",
    "**/*.log",
  ],
};

function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` = zero or more directories; trailing `**` = anything.
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if ("\\^$+?.()|{}[]".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`${out}$`, "i");
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

/** Classify a CANONICAL workspace-relative path under a policy. */
export function classifyWorkspacePath(
  path: string,
  policy: WorkspaceFilePolicy,
): WorkspacePathClass {
  const lower = path.toLowerCase();
  if (lower === ".git" || lower.startsWith(".git/")) return "internal";
  if (matchesAny(path, policy.secretPatterns)) return "secret";
  if (matchesAny(path, policy.generatedPatterns)) return "generated";
  if (matchesAny(path, policy.protectedPatterns)) return "protected";
  return "normal";
}
