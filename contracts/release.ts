/**
 * EO-4.6 — governed source control & deployment orchestration.
 *
 *   WRITE ≠ STAGE ≠ COMMIT ≠ PUSH ≠ DEPLOY · DEPLOYED ≠ HEALTHY ·
 *   REVIEW ≠ APPROVAL · BUILD ≠ SIGN ≠ PUBLISH
 *
 * Every transition is its own, separately authorized operation. Repository
 * identity, remotes, branches and deployment targets come from trusted
 * configuration only — never from a request, an agent or a model.
 */
import { ValidationError } from "./index.js";
import { requireExecutionId } from "./execution.js";

/* ------------------------------------------------------------------ */
/* Review (≠ approval)                                                */
/* ------------------------------------------------------------------ */

export const REVIEW_STATUSES = [
  "pending",
  "approved",
  "changes_requested",
  "rejected",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Technical acceptance of ONE verified source state. */
export interface ReviewRecord {
  reviewId: string;
  projectId: string;
  changeSetId: string;
  verificationId: string;
  /** The exact source the review looked at; other source is not reviewed. */
  sourceFingerprint: string;
  reviewerId: string;
  reviewerKind: "agent" | "operator";
  status: ReviewStatus;
  summary?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Repository / branch policy                                         */
/* ------------------------------------------------------------------ */

export interface BranchPolicy {
  defaultBranch: string;
  /** Branches AI Workforce may never push to directly. */
  protectedBranches: readonly string[];
  /** Branches that accept a direct (fast-forward) push. */
  directPushBranches: readonly string[];
  /** Working branches are `${prefix}<changeSetId>`. */
  workingBranchPrefix: string;
  /** A PR is required to reach a protected branch. */
  pullRequestRequired: boolean;
}

/** Trusted, versioned per-project repository policy. */
export interface RepositoryPolicy {
  projectId: string;
  repositoryId: string;
  version: number;
  branch: BranchPolicy;
  requireReview: boolean;
  /** The ChangeSet author may not be the (sole) approving reviewer. */
  requireIndependentReview: boolean;
  requireCommitApproval: boolean;
  requirePushApproval: boolean;
  /** Automation identity for commits (never a human by default). */
  commitIdentity: { name: string; email: string };
  /** Push credential reference (resolved server-side only). */
  credentialRef?: `secret://${string}`;
}

const REF_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** Bounded, safe branch names (no `..`, `@{`, control chars, locks, HEAD). */
export function validateBranchName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) {
    throw new ValidationError("branch name must be 1-120 characters");
  }
  const parts = value.split("/");
  if (
    parts.length > 4 ||
    !parts.every((p) => REF_SEGMENT.test(p) && !p.endsWith(".lock")) ||
    value.includes("..") ||
    value === "HEAD" ||
    value.startsWith("-")
  ) {
    throw new ValidationError(
      `branch name ${value.slice(0, 40)} is not allowed`,
    );
  }
  return value;
}

export function validateRepositoryPolicy(policy: RepositoryPolicy): void {
  requireExecutionId(policy.projectId, "policy.projectId");
  requireExecutionId(policy.repositoryId, "policy.repositoryId");
  validateBranchName(policy.branch.defaultBranch);
  policy.branch.protectedBranches.forEach(validateBranchName);
  policy.branch.directPushBranches.forEach(validateBranchName);
  for (const b of policy.branch.directPushBranches) {
    if (policy.branch.protectedBranches.includes(b)) {
      throw new ValidationError(
        `branch ${b} cannot be both protected and direct-push`,
      );
    }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,30}\/$/.test(policy.branch.workingBranchPrefix)) {
    throw new ValidationError("workingBranchPrefix must look like `aiw/`");
  }
  if (
    !/^[^<>\n]{1,80}$/.test(policy.commitIdentity.name) ||
    !/^[^<>\s@]+@[^<>\s@]+$/.test(policy.commitIdentity.email)
  ) {
    throw new ValidationError("commitIdentity is not valid");
  }
}

/* ------------------------------------------------------------------ */
/* Stage set, commit, push                                            */
/* ------------------------------------------------------------------ */

export interface StageSetFile {
  path: string;
  change: "created" | "modified" | "deleted" | "renamed";
  /** For renames: the old path (its deletion is part of the same change). */
  fromPath?: string;
}

/** Exactly the reviewed + verified ChangeSet files, nothing else. */
export interface StageSet {
  stageSetId: string;
  projectId: string;
  repositoryId: string;
  changeSetId: string;
  workspaceId: string;
  /** The developer session that authored the ChangeSet. */
  sessionId: string;
  baseRevision?: string;
  files: readonly StageSetFile[];
  /** ChangeSet paths that were NOT staged, with the reason. */
  excluded: readonly { path: string; reason: string }[];
  sourceFingerprint: string;
  verificationId: string;
  reviewId?: string;
  planId: string;
  planVersion: number;
  createdBy: string;
  createdAt: string;
}

export interface CommitReceipt {
  receiptId: string;
  projectId: string;
  repositoryId: string;
  branch: string;
  commitSha: string;
  parentSha?: string;
  message: string;
  stageSetId: string;
  changeSetId: string;
  sourceFingerprint: string;
  verificationId: string;
  reviewId?: string;
  approvalIds: readonly string[];
  policyVersion: number;
  actor: string;
  createdAt: string;
}

export interface PushReceipt {
  receiptId: string;
  projectId: string;
  repositoryId: string;
  remoteId: string;
  branch: string;
  commitSha: string;
  /** Remote branch revision the push was conditioned on (lease). */
  expectedRemoteSha?: string;
  result: "pushed" | "up_to_date";
  /** The target branch is protected: a pull request is required. */
  pullRequestRequired: boolean;
  approvalIds: readonly string[];
  commitReceiptId: string;
  policyVersion: number;
  actor: string;
  createdAt: string;
}

export interface PullRequestRecord {
  pullRequestId: string;
  projectId: string;
  provider: string;
  number?: number;
  sourceBranch: string;
  targetBranch: string;
  commitSha: string;
  status: "open" | "merged" | "closed";
  /** Remote CI is only what the provider reports — never assumed. */
  checks: "unknown" | "pending" | "passed" | "failed";
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Deployment                                                         */
/* ------------------------------------------------------------------ */

export const DEPLOYMENT_TARGET_CLASSES = [
  "development",
  "preview",
  "staging",
  "production",
] as const;
export type DeploymentTargetClass = (typeof DEPLOYMENT_TARGET_CLASSES)[number];

/** Registered by trusted composition; a request only names `targetId`. */
export interface DeploymentTarget {
  targetId: string;
  projectId: string;
  targetClass: DeploymentTargetClass;
  adapterId: string;
  /** Provider-scoped resources, e.g. ["hosting"] — never "everything". */
  resources: readonly string[];
  /** Trusted provider reference (e.g. a Firebase project id). */
  providerRef: string;
  /** Deployment credential reference (resolved server-side only). */
  credentialRef?: `secret://${string}`;
  timeoutMs: number;
}

export const RELEASE_STATUSES = [
  "pending",
  "deploying",
  "deployed",
  "verifying",
  "healthy",
  "degraded",
  "failed",
  "rolled_back",
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export interface TargetClassRequirements {
  requireReview: boolean;
  requireApproval: boolean;
  requirePostDeployVerification: boolean;
  requireRollbackPlan: boolean;
  /** Health-triggered rollback — never on unless explicitly set. */
  automaticRollback: boolean;
  requireRollbackApproval: boolean;
}

/** Trusted, versioned per-project release policy. */
export interface ReleasePolicy {
  projectId: string;
  version: number;
  targets: Readonly<Record<DeploymentTargetClass, TargetClassRequirements>>;
}

/** Exact, immutable thing to deploy. */
export interface DeploymentCandidate {
  candidateId: string;
  projectId: string;
  planId: string;
  planVersion: number;
  changeSetId: string;
  sourceFingerprint: string;
  commitSha: string;
  pushReceiptId: string;
  verificationId: string;
  reviewId?: string;
  artifacts: readonly { artifactId: string; path: string; sha256: string }[];
  targetId: string;
  releasePolicyVersion: number;
  createdBy: string;
  createdAt: string;
}

export interface PostDeployVerification {
  reachable: boolean;
  /** Version identity the target reports (commit/release id). */
  reportedVersion?: string;
  versionMatches: boolean;
  checkedAt: string;
  detail: string;
}

export interface ReleaseReceipt {
  releaseId: string;
  projectId: string;
  candidateId: string;
  commitSha: string;
  artifactDigests: readonly string[];
  targetId: string;
  targetClass: DeploymentTargetClass;
  adapterId: string;
  adapterVersion: string;
  providerReleaseId?: string;
  approvalIds: readonly string[];
  releasePolicyVersion: number;
  status: ReleaseStatus;
  reasons: readonly { code: string; detail: string }[];
  postDeploy?: PostDeployVerification;
  rollback?: { fromReleaseId: string; toReleaseId: string; automatic: boolean };
  /** Authoritative duration only — never a fabricated cost. */
  durationMs?: number;
  simulated: boolean;
  actor: string;
  startedAt: string;
  endedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Ports (implemented by trusted adapters)                            */
/* ------------------------------------------------------------------ */

/**
 * Bounded source-control port. There is no method that accepts git
 * arguments, a remote URL, a force flag or a refspec: the adapter resolves
 * the repository and remote of `projectId` from trusted configuration.
 */
export interface GovernedGitPort {
  head(projectId: string): Promise<{ sha?: string; branch?: string }>;
  commit(
    projectId: string,
    input: {
      files: readonly StageSetFile[];
      message: string;
      identity: { name: string; email: string };
      expectedHead?: string;
    },
  ): Promise<{ sha: string; parentSha?: string; files: readonly string[] }>;
  readCommit(
    projectId: string,
    sha: string,
  ): Promise<
    | { sha: string; parents: readonly string[]; files: readonly string[] }
    | undefined
  >;
  remoteId(projectId: string): string;
  remoteHead(
    projectId: string,
    branch: string,
    credential?: string,
  ): Promise<string | undefined>;
  /** Fast-forward only. Never forced. */
  push(
    projectId: string,
    input: { branch: string; commitSha: string; credential?: string },
  ): Promise<"pushed" | "up_to_date">;
}

export interface PullRequestPort {
  readonly provider: string;
  create(input: {
    projectId: string;
    sourceBranch: string;
    targetBranch: string;
    commitSha: string;
    title: string;
    body: string;
  }): Promise<{ number: number }>;
}

export interface DeploymentContext {
  candidate: DeploymentCandidate;
  target: DeploymentTarget;
  signal: AbortSignal;
  /** Resolved deployment credential (server-side only). */
  credential?: string;
}

/**
 * Provider-specific, bounded deployment adapter. There is no
 * `deploy(command)`: the target and resources come from `target`.
 */
export interface DeploymentAdapter {
  readonly adapterId: string;
  readonly version: string;
  /** Test/simulation adapter: receipts are labelled simulated. */
  readonly simulated?: boolean;
  deploy(ctx: DeploymentContext): Promise<{ providerReleaseId: string }>;
  /** Bounded post-deploy verification (health + version identity). */
  verify(
    ctx: DeploymentContext,
  ): Promise<{ reachable: boolean; reportedVersion?: string; detail: string }>;
  /** Restore a known previous provider release (never "deploy latest"). */
  rollback?(ctx: DeploymentContext, toProviderReleaseId: string): Promise<void>;
}
