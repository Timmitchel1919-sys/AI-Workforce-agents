/**
 * EO-4.6 SourceControlOrchestrator — governed review → stage → commit → push.
 *
 *   WRITE ≠ STAGE ≠ COMMIT ≠ PUSH ≠ DEPLOY · REVIEW ≠ APPROVAL
 *
 * Each transition is a separate, separately authorized command:
 *   review   (independent; bound to one verification + source fingerprint)
 *   stage    (StageSet = exactly the reviewed, verified ChangeSet files)
 *   commit   (source fingerprint re-checked; system-built message; receipt)
 *   push     (branch policy; registered remote; fast-forward only; receipt)
 * Git itself is behind a bounded port: there is no raw git, no remote URL,
 * no refspec and no force flag anywhere in this API.
 */
import {
  DEFAULT_WORKSPACE_FILE_POLICY,
  ExecutionDeniedError,
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  classifyWorkspacePath,
  isTerminalSession,
  operatorCan,
  operatorCanAccessProject,
  requireExecutionId,
  validateBranchName,
  validateRepositoryPolicy,
  type CommitReceipt,
  type ControlCapability,
  type GovernedGitPort,
  type OperatorPrincipal,
  type PullRequestPort,
  type PullRequestRecord,
  type PushReceipt,
  type RepositoryPolicy,
  type ReviewRecord,
  type ReviewStatus,
  type SecretReference,
  type StageSet,
  type StageSetFile,
  type VerificationResult,
  type WorkspaceControl,
  type WorkspaceFilePolicy,
} from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ExecutionManager } from "../execution/execution-manager.js";
import type { VerificationService } from "../execution/verification-service.js";
import { createId, now } from "../shared.js";
import {
  checkBoundApproval,
  requestBoundApproval,
} from "./approval-binding.js";

export interface SecretValueResolver {
  resolve(ref: SecretReference): Promise<string>;
}

export interface SourceControlOrchestratorOptions {
  git: GovernedGitPort;
  verification: Pick<VerificationService, "get">;
  manager: Pick<ExecutionManager, "getSession" | "getChangeSet">;
  workspaceControl: Pick<WorkspaceControl, "sourceFingerprint">;
  approvals: Pick<ApprovalSystem, "get" | "request">;
  projects: { has(projectId: string): boolean };
  audit: AuditLog;
  credentials?: SecretValueResolver;
  pullRequests?: PullRequestPort;
  filePolicy?: WorkspaceFilePolicy;
  clock?: () => string;
  idFactory?: (prefix: string) => string;
}

const deny = (code: ExecutionDeniedError["code"], detail: string): never => {
  throw new ExecutionDeniedError(code, detail);
};

function onlyKeys(
  raw: unknown,
  keys: readonly string[],
  what: string,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError(`${what} must be an object`);
  }
  for (const k of Object.keys(raw)) {
    // Refuses git arguments, remote URLs, refspecs and force flags outright.
    if (!keys.includes(k)) throw new ValidationError(`unknown field ${k}`);
  }
  return raw as Record<string, unknown>;
}

const optionalId = (v: unknown, field: string) =>
  v === undefined ? undefined : requireExecutionId(v, field);

/** Commit summaries are data: one bounded line, no control characters. */
export function sanitizeSummary(value: unknown): string {
  if (typeof value !== "string")
    throw new ValidationError("summary is required");
  let clean = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    clean += code < 32 || code === 127 ? " " : ch;
  }
  clean = clean.replace(/\s+/g, " ").trim();
  if (clean.length < 3 || clean.length > 72) {
    throw new ValidationError("summary must be 3-72 characters on one line");
  }
  return clean;
}

export class SourceControlOrchestrator {
  private readonly clock: () => string;
  private readonly newId: (prefix: string) => string;
  private readonly policies = new Map<string, RepositoryPolicy>();
  private readonly reviews = new Map<string, ReviewRecord>();
  private readonly stageSets = new Map<string, StageSet>();
  private readonly commits = new Map<string, CommitReceipt>();
  private readonly pushes = new Map<string, PushReceipt>();
  private readonly pullRequests = new Map<string, PullRequestRecord>();
  private readonly idempotency = new Map<string, string>();

  constructor(private readonly options: SourceControlOrchestratorOptions) {
    this.clock = options.clock ?? now;
    this.newId = options.idFactory ?? createId;
  }

  /** Trusted composition only. */
  setRepositoryPolicy(policy: RepositoryPolicy): void {
    validateRepositoryPolicy(policy);
    this.policies.set(policy.projectId, Object.freeze({ ...policy }));
  }

  private policy(projectId: string): RepositoryPolicy {
    return (
      this.policies.get(projectId) ??
      deny("POLICY_DENIED", "no repository policy governs this project")
    );
  }

  private authorize(
    principal: OperatorPrincipal,
    projectId: string,
    capability: ControlCapability,
  ): void {
    if (
      !operatorCanAccessProject(principal, projectId) ||
      !this.options.projects.has(projectId)
    ) {
      throw new NotFoundError("resource not found");
    }
    if (!operatorCan(principal, capability)) {
      throw new PermissionDeniedError(
        `operator ${principal.id} lacks the ${capability} capability`,
      );
    }
  }

  private record(
    action: string,
    actor: string,
    projectId: string,
    data: Record<string, unknown>,
  ): void {
    this.options.audit.record("execution_event", {
      projectId,
      data: { ...data, action, actor },
    });
  }

  private replay<T>(
    principal: OperatorPrincipal,
    key: string,
    store: Map<string, T>,
  ): T | undefined {
    const id = this.idempotency.get(
      `${principal.id}\u0000${requireExecutionId(key, "idempotencyKey")}`,
    );
    return id ? store.get(id) : undefined;
  }

  private remember(
    principal: OperatorPrincipal,
    key: string,
    id: string,
  ): void {
    this.idempotency.set(`${principal.id}\u0000${key}`, id);
  }

  /* -------------------------------------------------------------- */
  /* Gates                                                          */
  /* -------------------------------------------------------------- */

  /** Verification must have PASSED, be terminal and carry a ChangeSet. */
  private passedVerification(
    principal: OperatorPrincipal,
    projectId: string,
    verificationId: string,
  ): VerificationResult {
    const v = this.options.verification.get(principal, verificationId);
    if (v.projectId !== projectId)
      throw new NotFoundError("resource not found");
    if (v.status !== "passed" || !v.changeSetId || !v.sourceSessionId) {
      deny("VERIFICATION_REQUIRED", "the ChangeSet has no passed verification");
    }
    return v;
  }

  /** The CURRENT source must equal the verified source. */
  private async assertSourceUnchanged(
    projectId: string,
    fingerprint: string,
  ): Promise<void> {
    const current =
      await this.options.workspaceControl.sourceFingerprint?.(projectId);
    if (!current || current.fingerprint !== fingerprint) {
      deny(
        "REVERIFICATION_REQUIRED",
        "the source changed after verification; verify it again",
      );
    }
  }

  /* -------------------------------------------------------------- */
  /* Review (independent; ≠ approval)                               */
  /* -------------------------------------------------------------- */

  private async storeReview(
    projectId: string,
    verification: VerificationResult,
    reviewerId: string,
    reviewerKind: ReviewRecord["reviewerKind"],
    status: ReviewStatus,
    summary: string | undefined,
    authorIds: readonly string[],
  ): Promise<ReviewRecord> {
    const policy = this.policy(projectId);
    if (policy.requireIndependentReview && authorIds.includes(reviewerId)) {
      deny(
        "REVIEW_NOT_INDEPENDENT",
        "the author of a ChangeSet cannot review it",
      );
    }
    const review: ReviewRecord = Object.freeze({
      reviewId: this.newId("rev"),
      projectId,
      changeSetId: verification.changeSetId!,
      verificationId: verification.verificationId,
      sourceFingerprint: verification.sourceFingerprint,
      reviewerId,
      reviewerKind,
      status,
      ...(summary ? { summary } : {}),
      createdAt: this.clock(),
    });
    this.reviews.set(review.reviewId, review);
    this.record("review_recorded", reviewerId, projectId, {
      reviewId: review.reviewId,
      changeSetId: review.changeSetId,
      verification: review.verificationId,
      status,
      reviewerKind,
    });
    return review;
  }

  private async authorsOf(
    principal: OperatorPrincipal,
    verification: VerificationResult,
  ): Promise<string[]> {
    const session = await this.options.manager.getSession(
      principal,
      verification.sourceSessionId!,
    );
    return [session.agentId, session.requestedBy];
  }

  /** An operator review (`review_change`). */
  async submitReview(
    principal: OperatorPrincipal,
    raw: unknown,
  ): Promise<ReviewRecord> {
    const body = onlyKeys(
      raw,
      ["projectId", "verificationId", "status", "summary"],
      "review",
    );
    const projectId = requireExecutionId(body.projectId, "projectId");
    this.authorize(principal, projectId, "review_change");
    const status = body.status as ReviewStatus;
    if (!["approved", "changes_requested", "rejected"].includes(status)) {
      throw new ValidationError(
        "status must be approved, changes_requested or rejected",
      );
    }
    const verification = this.passedVerification(
      principal,
      projectId,
      requireExecutionId(body.verificationId, "verificationId"),
    );
    const summary =
      body.summary === undefined ? undefined : sanitizeSummary(body.summary);
    return this.storeReview(
      projectId,
      verification,
      principal.id,
      "operator",
      status,
      summary,
      await this.authorsOf(principal, verification),
    );
  }

  /**
   * A reviewer-AGENT review, recorded by trusted orchestration (the agent
   * never calls this directly). The authoring agent can never review.
   */
  async recordAgentReview(
    principal: OperatorPrincipal,
    input: {
      projectId: string;
      verificationId: string;
      reviewerAgentId: string;
      status: ReviewStatus;
      summary?: string;
    },
  ): Promise<ReviewRecord> {
    this.authorize(principal, input.projectId, "view");
    const verification = this.passedVerification(
      principal,
      input.projectId,
      input.verificationId,
    );
    return this.storeReview(
      input.projectId,
      verification,
      requireExecutionId(input.reviewerAgentId, "reviewerAgentId"),
      "agent",
      input.status,
      input.summary === undefined ? undefined : sanitizeSummary(input.summary),
      await this.authorsOf(principal, verification),
    );
  }

  /* -------------------------------------------------------------- */
  /* Stage set                                                      */
  /* -------------------------------------------------------------- */

  async prepareStageSet(
    principal: OperatorPrincipal,
    raw: unknown,
  ): Promise<StageSet> {
    const body = onlyKeys(
      raw,
      ["projectId", "verificationId", "reviewId"],
      "stage set request",
    );
    const projectId = requireExecutionId(body.projectId, "projectId");
    this.authorize(principal, projectId, "commit_source");
    const policy = this.policy(projectId);
    const verification = this.passedVerification(
      principal,
      projectId,
      requireExecutionId(body.verificationId, "verificationId"),
    );
    const reviewId = optionalId(body.reviewId, "reviewId");
    const review = reviewId ? this.reviews.get(reviewId) : undefined;
    if (policy.requireReview) {
      if (!review || review.projectId !== projectId)
        deny("REVIEW_REQUIRED", "an approved review is required");
      if (review!.status !== "approved")
        deny("REVIEW_REQUIRED", `the review is ${review!.status}`);
      if (
        review!.verificationId !== verification.verificationId ||
        review!.sourceFingerprint !== verification.sourceFingerprint
      ) {
        deny("REVIEW_REQUIRED", "the review covers a different source state");
      }
      if (policy.requireIndependentReview) {
        const authors = await this.authorsOf(principal, verification);
        if (authors.includes(review!.reviewerId))
          deny(
            "REVIEW_NOT_INDEPENDENT",
            "the author reviewed their own change",
          );
      }
    }
    await this.assertSourceUnchanged(projectId, verification.sourceFingerprint);
    const session = await this.options.manager.getSession(
      principal,
      verification.sourceSessionId!,
    );
    if (!isTerminalSession(session.status)) {
      throw new StateTransitionError("the authoring session is still open");
    }
    const changeSet = await this.options.manager.getChangeSet(
      principal,
      session.sessionId,
    );
    if (!changeSet || changeSet.changeSetId !== verification.changeSetId) {
      throw new NotFoundError("resource not found");
    }
    const filePolicy = this.options.filePolicy ?? DEFAULT_WORKSPACE_FILE_POLICY;
    const files: StageSetFile[] = [];
    const excluded: { path: string; reason: string }[] = [];
    for (const entry of changeSet.entries) {
      const cls = classifyWorkspacePath(entry.path, filePolicy);
      if (cls === "secret" || cls === "internal" || cls === "generated") {
        excluded.push({
          path: entry.path,
          reason: `${cls} files are never staged`,
        });
        continue;
      }
      files.push({
        path: entry.path,
        change: entry.change,
        ...(entry.fromPath ? { fromPath: entry.fromPath } : {}),
      });
    }
    if (files.length === 0)
      deny("STAGING_CONFLICT", "the ChangeSet has no stageable files");
    const head = await this.options.git.head(projectId);
    const stageSet: StageSet = Object.freeze({
      stageSetId: this.newId("stg"),
      projectId,
      repositoryId: policy.repositoryId,
      changeSetId: changeSet.changeSetId,
      workspaceId: changeSet.workspaceId,
      sessionId: session.sessionId,
      ...(head.sha ? { baseRevision: head.sha } : {}),
      files: Object.freeze(files.sort((a, b) => a.path.localeCompare(b.path))),
      excluded: Object.freeze(excluded),
      sourceFingerprint: verification.sourceFingerprint,
      verificationId: verification.verificationId,
      ...(review ? { reviewId: review.reviewId } : {}),
      planId: verification.plan.planId,
      planVersion: verification.plan.version,
      createdBy: principal.id,
      createdAt: this.clock(),
    });
    this.stageSets.set(stageSet.stageSetId, stageSet);
    this.record("stage_set_created", principal.id, projectId, {
      stageSetId: stageSet.stageSetId,
      changeSetId: stageSet.changeSetId,
      files: stageSet.files.length,
      excluded: excluded.length,
    });
    return stageSet;
  }

  /** Request an approval bound to one stage set / commit (operators decide it). */
  requestApproval(
    principal: OperatorPrincipal,
    raw: unknown,
  ): ReturnType<typeof requestBoundApproval> {
    const body = onlyKeys(
      raw,
      ["projectId", "operation", "subjectId", "reason"],
      "approval request",
    );
    const projectId = requireExecutionId(body.projectId, "projectId");
    const subjectId = requireExecutionId(body.subjectId, "subjectId");
    if (body.operation === "commit") {
      this.authorize(principal, projectId, "commit_source");
      const stage = this.stageSets.get(subjectId);
      if (!stage || stage.projectId !== projectId)
        throw new NotFoundError("resource not found");
      return requestBoundApproval(
        this.options.approvals,
        {
          action: "release.commit",
          projectId,
          subjectId,
          sourceFingerprint: stage.sourceFingerprint,
        },
        principal.id,
        String(body.reason ?? ""),
      );
    }
    if (body.operation === "push") {
      this.authorize(principal, projectId, "push_source");
      const commit = this.commits.get(subjectId);
      if (!commit || commit.projectId !== projectId)
        throw new NotFoundError("resource not found");
      return requestBoundApproval(
        this.options.approvals,
        {
          action: "release.push",
          projectId,
          subjectId,
          commitSha: commit.commitSha,
          branch: this.pushBranch(commit).branch,
        },
        principal.id,
        String(body.reason ?? ""),
      );
    }
    throw new ValidationError("operation must be commit or push");
  }

  /* -------------------------------------------------------------- */
  /* Commit                                                         */
  /* -------------------------------------------------------------- */

  async commit(
    principal: OperatorPrincipal,
    raw: unknown,
    idempotencyKey: string,
  ): Promise<CommitReceipt> {
    const body = onlyKeys(
      raw,
      ["projectId", "stageSetId", "summary", "type", "approvalId"],
      "commit request",
    );
    const projectId = requireExecutionId(body.projectId, "projectId");
    this.authorize(principal, projectId, "commit_source");
    const replayed = this.replay(principal, idempotencyKey, this.commits);
    if (replayed) return replayed;
    const policy = this.policy(projectId);
    const stage = this.stageSets.get(
      requireExecutionId(body.stageSetId, "stageSetId"),
    );
    if (!stage || stage.projectId !== projectId)
      throw new NotFoundError("resource not found");
    if (
      [...this.commits.values()].some((c) => c.stageSetId === stage.stageSetId)
    ) {
      throw new StateTransitionError("this stage set was already committed");
    }
    const type = body.type === undefined ? "feat" : body.type;
    if (
      !["feat", "fix", "refactor", "test", "docs", "chore"].includes(
        type as string,
      )
    ) {
      throw new ValidationError("type must be a Conventional Commit type");
    }
    const summary = sanitizeSummary(body.summary);
    // Every gate again, at commit time.
    const verification = this.passedVerification(
      principal,
      projectId,
      stage.verificationId,
    );
    if (verification.sourceFingerprint !== stage.sourceFingerprint)
      deny("REVERIFICATION_REQUIRED", "the stage set is stale");
    await this.assertSourceUnchanged(projectId, stage.sourceFingerprint);
    if (policy.requireReview) {
      const review = stage.reviewId
        ? this.reviews.get(stage.reviewId)
        : undefined;
      if (
        !review ||
        review.status !== "approved" ||
        review.sourceFingerprint !== stage.sourceFingerprint
      ) {
        deny(
          "REVIEW_REQUIRED",
          "an approved review of this source is required",
        );
      }
    }
    const approvalId = optionalId(body.approvalId, "approvalId");
    if (policy.requireCommitApproval) {
      const reason = checkBoundApproval(
        this.options.approvals,
        approvalId,
        {
          action: "release.commit",
          projectId,
          subjectId: stage.stageSetId,
          sourceFingerprint: stage.sourceFingerprint,
        },
        this.clock(),
      );
      if (reason) deny(reason.code, reason.detail);
    }
    const head = await this.options.git.head(projectId);
    if (!head.branch)
      deny("COMMIT_FAILED", "the repository is not on a branch");
    // System-built message: summary is data; trailers are trusted metadata.
    const message = [
      `${type}: ${summary}`,
      "",
      `AI-Workforce-Project: ${projectId}`,
      `AI-Workforce-Plan: ${stage.planId}@v${stage.planVersion}`,
      `AI-Workforce-ChangeSet: ${stage.changeSetId}`,
      `AI-Workforce-Verification: ${stage.verificationId}`,
      ...(stage.reviewId ? [`AI-Workforce-Review: ${stage.reviewId}`] : []),
      `AI-Workforce-Session: ${stage.sessionId}`,
    ].join("\n");
    this.record("commit_requested", principal.id, projectId, {
      stageSetId: stage.stageSetId,
    });
    let result;
    try {
      result = await this.options.git.commit(projectId, {
        files: stage.files,
        message,
        identity: policy.commitIdentity,
        ...(stage.baseRevision ? { expectedHead: stage.baseRevision } : {}),
      });
    } catch (error) {
      this.record("commit_failed", principal.id, projectId, {
        stageSetId: stage.stageSetId,
        code:
          error instanceof ExecutionDeniedError ? error.code : "COMMIT_FAILED",
      });
      throw error instanceof ExecutionDeniedError
        ? error
        : new ExecutionDeniedError("COMMIT_FAILED", "the commit failed");
    }
    // Verify the resulting commit contains exactly the stage set.
    const expected = new Set(
      stage.files.flatMap((f) => [f.path, ...(f.fromPath ? [f.fromPath] : [])]),
    );
    const actual = new Set(result.files);
    if (
      expected.size !== actual.size ||
      [...expected].some((p) => !actual.has(p))
    ) {
      this.record("commit_failed", principal.id, projectId, {
        stageSetId: stage.stageSetId,
        code: "COMMIT_FAILED",
        commitSha: result.sha,
      });
      deny(
        "COMMIT_FAILED",
        "the created commit does not match the stage set; it will not be pushed",
      );
    }
    const receipt: CommitReceipt = Object.freeze({
      receiptId: this.newId("cmr"),
      projectId,
      repositoryId: policy.repositoryId,
      branch: head.branch!,
      commitSha: result.sha,
      ...(result.parentSha ? { parentSha: result.parentSha } : {}),
      message,
      stageSetId: stage.stageSetId,
      changeSetId: stage.changeSetId,
      sourceFingerprint: stage.sourceFingerprint,
      verificationId: stage.verificationId,
      ...(stage.reviewId ? { reviewId: stage.reviewId } : {}),
      approvalIds: approvalId ? [approvalId] : [],
      policyVersion: policy.version,
      actor: principal.id,
      createdAt: this.clock(),
    });
    this.commits.set(receipt.receiptId, receipt);
    this.remember(principal, idempotencyKey, receipt.receiptId);
    this.record("commit_completed", principal.id, projectId, {
      receiptId: receipt.receiptId,
      commitSha: receipt.commitSha,
      branch: receipt.branch,
      changeSetId: receipt.changeSetId,
    });
    return receipt;
  }

  /* -------------------------------------------------------------- */
  /* Push                                                           */
  /* -------------------------------------------------------------- */

  /** Branch policy decides where a commit may go (never the caller). */
  private pushBranch(commit: CommitReceipt): {
    branch: string;
    pullRequestRequired: boolean;
  } {
    const policy = this.policy(commit.projectId);
    if (policy.branch.directPushBranches.includes(commit.branch)) {
      return { branch: commit.branch, pullRequestRequired: false };
    }
    if (
      policy.branch.protectedBranches.includes(commit.branch) ||
      commit.branch === policy.branch.defaultBranch
    ) {
      return {
        branch: validateBranchName(
          `${policy.branch.workingBranchPrefix}${commit.changeSetId}`,
        ),
        pullRequestRequired: policy.branch.pullRequestRequired,
      };
    }
    return {
      branch: validateBranchName(commit.branch),
      pullRequestRequired: false,
    };
  }

  async push(
    principal: OperatorPrincipal,
    raw: unknown,
    idempotencyKey: string,
  ): Promise<PushReceipt> {
    const body = onlyKeys(
      raw,
      ["projectId", "commitReceiptId", "approvalId"],
      "push request",
    );
    const projectId = requireExecutionId(body.projectId, "projectId");
    this.authorize(principal, projectId, "push_source");
    const replayed = this.replay(principal, idempotencyKey, this.pushes);
    if (replayed) return replayed;
    const policy = this.policy(projectId);
    const commit = this.commits.get(
      requireExecutionId(body.commitReceiptId, "commitReceiptId"),
    );
    if (!commit || commit.projectId !== projectId)
      throw new NotFoundError("resource not found");
    // Preflight: the commit still exists and is exactly what was committed.
    const read = await this.options.git.readCommit(projectId, commit.commitSha);
    if (!read) deny("PUSH_FAILED", "the commit no longer exists locally");
    if (policy.version !== commit.policyVersion) {
      deny(
        "POLICY_DENIED",
        "the repository policy changed since the commit; re-evaluate",
      );
    }
    const { branch, pullRequestRequired } = this.pushBranch(commit);
    const approvalId = optionalId(body.approvalId, "approvalId");
    if (policy.requirePushApproval) {
      const reason = checkBoundApproval(
        this.options.approvals,
        approvalId,
        {
          action: "release.push",
          projectId,
          subjectId: commit.receiptId,
          commitSha: commit.commitSha,
          branch,
        },
        this.clock(),
      );
      if (reason) deny(reason.code, reason.detail);
    }
    const credential = policy.credentialRef
      ? await (
          this.options.credentials ??
          deny("PUSH_FAILED", "repository credentials cannot be resolved")
        ).resolve(policy.credentialRef)
      : undefined;
    // Remote concurrency: the remote branch must be exactly our parent (or
    // absent for a new working branch). Otherwise nothing is overwritten.
    const remote = await this.options.git.remoteHead(
      projectId,
      branch,
      credential,
    );
    if (remote && remote !== commit.commitSha && remote !== read!.parents[0]) {
      this.record("push_blocked", principal.id, projectId, {
        receiptId: commit.receiptId,
        branch,
        code: "REMOTE_CHANGED",
      });
      deny(
        "REMOTE_CHANGED",
        "the remote branch moved since this commit was based on it",
      );
    }
    this.record("push_requested", principal.id, projectId, {
      commitSha: commit.commitSha,
      branch,
    });
    const result = await this.options.git.push(projectId, {
      branch,
      commitSha: commit.commitSha,
      ...(credential ? { credential } : {}),
    });
    const receipt: PushReceipt = Object.freeze({
      receiptId: this.newId("psr"),
      projectId,
      repositoryId: policy.repositoryId,
      remoteId: this.options.git.remoteId(projectId),
      branch,
      commitSha: commit.commitSha,
      ...(remote ? { expectedRemoteSha: remote } : {}),
      result,
      pullRequestRequired,
      approvalIds: approvalId ? [approvalId] : [],
      commitReceiptId: commit.receiptId,
      policyVersion: policy.version,
      actor: principal.id,
      createdAt: this.clock(),
    });
    this.pushes.set(receipt.receiptId, receipt);
    this.remember(principal, idempotencyKey, receipt.receiptId);
    this.record("push_completed", principal.id, projectId, {
      receiptId: receipt.receiptId,
      commitSha: receipt.commitSha,
      branch,
      result,
    });
    if (pullRequestRequired && this.options.pullRequests) {
      const pr = await this.options.pullRequests.create({
        projectId,
        sourceBranch: branch,
        targetBranch: policy.branch.defaultBranch,
        commitSha: commit.commitSha,
        title: commit.message.split("\n")[0]!,
        body: commit.message.split("\n").slice(2).join("\n"),
      });
      const record: PullRequestRecord = Object.freeze({
        pullRequestId: this.newId("pr"),
        projectId,
        provider: this.options.pullRequests.provider,
        number: pr.number,
        sourceBranch: branch,
        targetBranch: policy.branch.defaultBranch,
        commitSha: commit.commitSha,
        status: "open",
        checks: "unknown",
        createdAt: this.clock(),
      });
      this.pullRequests.set(record.pullRequestId, record);
      this.record("pull_request_created", principal.id, projectId, {
        pullRequestId: record.pullRequestId,
        number: pr.number,
        branch,
      });
    }
    return receipt;
  }

  /* -------------------------------------------------------------- */
  /* Reads (project-scoped, bounded)                                */
  /* -------------------------------------------------------------- */

  getCommitReceipt(
    principal: OperatorPrincipal,
    projectId: string,
    receiptId: string,
  ): CommitReceipt {
    this.authorize(principal, projectId, "view");
    const commit = this.commits.get(receiptId);
    if (!commit || commit.projectId !== projectId)
      throw new NotFoundError("resource not found");
    return commit;
  }

  getPushReceipt(
    principal: OperatorPrincipal,
    projectId: string,
    receiptId: string,
  ): PushReceipt {
    this.authorize(principal, projectId, "view");
    const push = this.pushes.get(receiptId);
    if (!push || push.projectId !== projectId)
      throw new NotFoundError("resource not found");
    return push;
  }

  activity(principal: OperatorPrincipal, projectId: string, limit = 50) {
    this.authorize(
      principal,
      requireExecutionId(projectId, "projectId"),
      "view",
    );
    const bound = Math.min(Math.max(1, limit), 200);
    const mine = <T extends { projectId: string; createdAt: string }>(
      m: Map<string, T>,
    ) =>
      [...m.values()]
        .filter((r) => r.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, bound);
    return {
      reviews: mine(this.reviews),
      stageSets: mine(this.stageSets),
      commits: mine(this.commits),
      pushes: mine(this.pushes),
      pullRequests: mine(this.pullRequests),
    };
  }
}
