/**
 * EO-4.6 DeploymentOrchestrator — candidate → gate → deploy → verify → receipt.
 *
 *   PUSH ≠ DEPLOY · DEPLOYED ≠ HEALTHY · ROLLBACK ≠ REDEPLOY LATEST
 *
 * - Targets, adapters and release policies come from trusted composition; a
 *   request only names a registered `targetId`. There is no deploy(command).
 * - A DeploymentCandidate pins an exact commit, source fingerprint,
 *   verification and artifact digests. A candidate that no longer matches
 *   its verification or the current policy version is STALE.
 * - Production is governed by the target class requirements (approval bound
 *   to exactly this candidate + target), a per-target lock and a timeout.
 * - HEALTHY needs post-deploy evidence: reachable AND the reported version
 *   equals the candidate commit. A provider "success" alone is DEPLOYED.
 * - Rollback restores a KNOWN previous healthy release on the same target
 *   and is itself approved; automatic rollback only when policy says so.
 */
import {
  DEPLOYMENT_TARGET_CLASSES,
  ExecutionDeniedError,
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  operatorCan,
  operatorCanAccessProject,
  requireExecutionId,
  type ArtifactIntegrity,
  type ArtifactRecord,
  type CommitReceipt,
  type ExecutionRecordStore,
  type ControlCapability,
  type DeploymentAdapter,
  type DeploymentCandidate,
  type DeploymentContext,
  type DeploymentTarget,
  type OperatorPrincipal,
  type PushReceipt,
  type ReleasePolicy,
  type ReleaseReceipt,
  type ReleaseStatus,
  type VerificationResult,
} from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import { createId, now } from "../shared.js";
import {
  checkBoundApproval,
  requestBoundApproval,
} from "./approval-binding.js";
import { DurableLedger } from "./durable-ledger.js";
import type { SecretValueResolver } from "./source-control-orchestrator.js";

export interface DeploymentOrchestratorOptions {
  sourceControl: {
    getPushReceipt(
      principal: OperatorPrincipal,
      projectId: string,
      receiptId: string,
    ): Promise<PushReceipt>;
    getCommitReceipt(
      principal: OperatorPrincipal,
      projectId: string,
      receiptId: string,
    ): Promise<CommitReceipt>;
  };
  verification: {
    load(
      principal: OperatorPrincipal,
      verificationId: string,
    ): Promise<VerificationResult>;
  };
  artifacts: {
    get(projectId: string, artifactId: string): ArtifactRecord | undefined;
    /** Re-digest an artifact (EO-4.8: checked again right before deploy). */
    verify(projectId: string, artifactId: string): Promise<ArtifactIntegrity>;
  };
  approvals: Pick<ApprovalSystem, "get" | "request">;
  projects: { has(projectId: string): boolean };
  audit: AuditLog;
  credentials?: SecretValueResolver;
  /** Lock lease per target (crash-safe). Default: 30 minutes. */
  lockTtlMs?: number;
  clock?: () => string;
  idFactory?: (prefix: string) => string;
  /** EO-4.8 durable candidates, releases and idempotency reservations. */
  store?: ExecutionRecordStore;
}

const deny = (code: ExecutionDeniedError["code"], detail: string): never => {
  throw new ExecutionDeniedError(code, detail);
};

function onlyKeys(
  raw: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ValidationError("request must be an object");
  for (const k of Object.keys(raw)) {
    // Refuses destinations, project ids, commands and resource lists.
    if (!keys.includes(k)) throw new ValidationError(`unknown field ${k}`);
  }
  return raw as Record<string, unknown>;
}

export class DeploymentOrchestrator {
  private readonly clock: () => string;
  private readonly newId: (prefix: string) => string;
  private readonly targets = new Map<string, DeploymentTarget>();
  private readonly adapters = new Map<string, DeploymentAdapter>();
  private readonly policies = new Map<string, ReleasePolicy>();
  private readonly locks = new Map<
    string,
    { releaseId: string; expiresAt: string }
  >();
  private readonly ledger: DurableLedger;

  constructor(private readonly options: DeploymentOrchestratorOptions) {
    this.clock = options.clock ?? now;
    this.newId = options.idFactory ?? createId;
    this.ledger = new DurableLedger(options.store, this.clock);
  }

  /* ---- trusted composition ------------------------------------- */

  registerAdapter(adapter: DeploymentAdapter): void {
    requireExecutionId(adapter.adapterId, "adapterId");
    if (this.adapters.has(adapter.adapterId))
      throw new Error(`adapter ${adapter.adapterId} already registered`);
    this.adapters.set(adapter.adapterId, adapter);
  }

  registerTarget(target: DeploymentTarget): void {
    requireExecutionId(target.targetId, "targetId");
    requireExecutionId(target.projectId, "projectId");
    if (!DEPLOYMENT_TARGET_CLASSES.includes(target.targetClass))
      throw new ValidationError("unknown target class");
    if (!this.adapters.has(target.adapterId))
      throw new Error(`unknown deployment adapter ${target.adapterId}`);
    if (target.resources.length === 0)
      throw new ValidationError("a target must name its resources");
    if (
      !Number.isInteger(target.timeoutMs) ||
      target.timeoutMs <= 0 ||
      target.timeoutMs > 3_600_000
    ) {
      throw new ValidationError("target.timeoutMs must be bounded");
    }
    if (this.targets.has(target.targetId))
      throw new Error(`target ${target.targetId} already registered`);
    this.targets.set(
      target.targetId,
      Object.freeze({ ...target, resources: [...target.resources] }),
    );
  }

  setReleasePolicy(policy: ReleasePolicy): void {
    requireExecutionId(policy.projectId, "projectId");
    for (const cls of DEPLOYMENT_TARGET_CLASSES) {
      if (!policy.targets[cls])
        throw new ValidationError(`release policy lacks ${cls}`);
    }
    this.policies.set(policy.projectId, Object.freeze({ ...policy }));
  }

  /* ---- helpers --------------------------------------------------- */

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
  ) {
    this.options.audit.record("execution_event", {
      projectId,
      data: { ...data, action, actor },
    });
  }

  private target(projectId: string, targetId: string): DeploymentTarget {
    const target = this.targets.get(targetId);
    // Another project's target and an unknown target look the same.
    if (!target || target.projectId !== projectId) {
      deny(
        "TARGET_NOT_REGISTERED",
        "the deployment target is not registered for this project",
      );
    }
    return target!;
  }

  private policy(projectId: string): ReleasePolicy {
    return (
      this.policies.get(projectId) ??
      deny("POLICY_DENIED", "no release policy governs this project")
    );
  }

  /* ---- candidate ----------------------------------------------- */

  async createCandidate(
    principal: OperatorPrincipal,
    raw: unknown,
  ): Promise<DeploymentCandidate> {
    const body = onlyKeys(raw, [
      "projectId",
      "pushReceiptId",
      "targetId",
      "artifactIds",
    ]);
    const projectId = requireExecutionId(body.projectId, "projectId");
    this.authorize(principal, projectId, "deploy_release");
    const push = await this.options.sourceControl.getPushReceipt(
      principal,
      projectId,
      requireExecutionId(body.pushReceiptId, "pushReceiptId"),
    );
    const target = this.target(
      projectId,
      requireExecutionId(body.targetId, "targetId"),
    );
    const policy = this.policy(projectId);
    // Provenance: the commit receipt behind the push (verification, source).
    const provenance = await this.options.sourceControl.getCommitReceipt(
      principal,
      projectId,
      push.commitReceiptId,
    );
    const artifactIds = Array.isArray(body.artifactIds)
      ? body.artifactIds.map((a, i) =>
          requireExecutionId(a, `artifactIds[${i}]`),
        )
      : [];
    const artifacts = artifactIds.map(
      (id) =>
        this.options.artifacts.get(projectId, id) ??
        deny(
          "STALE_CANDIDATE",
          `artifact ${id} is not recorded for this project`,
        ),
    );
    const sources = new Set(artifacts.map((a) => a.sourceFingerprint));
    const verificationIds = new Set(artifacts.map((a) => a.verificationId));
    if (sources.size > 1 || verificationIds.size > 1) {
      deny("STALE_CANDIDATE", "artifacts come from different source states");
    }
    const verification = await this.options.verification.load(
      principal,
      provenance.verificationId,
    );
    if (
      verification.status !== "passed" ||
      verification.sourceFingerprint !== provenance.sourceFingerprint
    ) {
      deny(
        "STALE_CANDIDATE",
        "the verification behind this commit is not a pass for its source",
      );
    }
    if (
      artifacts.length > 0 &&
      ([...sources][0] !== provenance.sourceFingerprint ||
        [...verificationIds][0] !== provenance.verificationId)
    ) {
      deny(
        "STALE_CANDIDATE",
        "artifacts were not produced by this commit's verification",
      );
    }
    const candidate: DeploymentCandidate = Object.freeze({
      candidateId: this.newId("dcn"),
      projectId,
      planId: verification.plan.planId,
      planVersion: verification.plan.version,
      changeSetId: provenance.changeSetId,
      sourceFingerprint: provenance.sourceFingerprint,
      commitSha: push.commitSha,
      pushReceiptId: push.receiptId,
      verificationId: provenance.verificationId,
      ...(provenance.reviewId ? { reviewId: provenance.reviewId } : {}),
      artifacts: Object.freeze(
        artifacts.map((a) => ({
          artifactId: a.artifactId,
          path: a.path,
          sha256: a.digest.value,
        })),
      ),
      targetId: target.targetId,
      releasePolicyVersion: policy.version,
      createdBy: principal.id,
      createdAt: this.clock(),
    });
    await this.ledger.save(
      "candidate",
      candidate.candidateId,
      projectId,
      candidate.createdAt,
      candidate,
    );
    this.record("deployment_candidate_created", principal.id, projectId, {
      candidateId: candidate.candidateId,
      commitSha: candidate.commitSha,
      targetId: target.targetId,
      targetClass: target.targetClass,
    });
    return candidate;
  }

  async requestApproval(principal: OperatorPrincipal, raw: unknown) {
    const body = onlyKeys(raw, [
      "projectId",
      "operation",
      "subjectId",
      "reason",
    ]);
    const projectId = requireExecutionId(body.projectId, "projectId");
    const subjectId = requireExecutionId(body.subjectId, "subjectId");
    if (body.operation === "deploy") {
      this.authorize(principal, projectId, "deploy_release");
      const c = await this.ledger.find<DeploymentCandidate>(
        "candidate",
        subjectId,
      );
      if (!c || c.projectId !== projectId)
        throw new NotFoundError("resource not found");
      return requestBoundApproval(
        this.options.approvals,
        {
          action: "release.deploy",
          projectId,
          subjectId,
          commitSha: c.commitSha,
          targetId: c.targetId,
        },
        principal.id,
        String(body.reason ?? ""),
      );
    }
    if (body.operation === "rollback") {
      this.authorize(principal, projectId, "rollback_release");
      const r = await this.ledger.find<ReleaseReceipt>("release", subjectId);
      if (!r || r.projectId !== projectId)
        throw new NotFoundError("resource not found");
      return requestBoundApproval(
        this.options.approvals,
        {
          action: "release.rollback",
          projectId,
          subjectId,
          targetId: r.targetId,
        },
        principal.id,
        String(body.reason ?? ""),
      );
    }
    throw new ValidationError("operation must be deploy or rollback");
  }

  /* ---- deploy -------------------------------------------------- */

  private acquireLock(targetId: string, releaseId: string): void {
    const held = this.locks.get(targetId);
    if (held && Date.parse(held.expiresAt) > Date.parse(this.clock())) {
      deny(
        "DEPLOYMENT_LOCKED",
        "another deployment to this target is in progress",
      );
    }
    this.locks.set(targetId, {
      releaseId,
      expiresAt: new Date(
        Date.parse(this.clock()) + (this.options.lockTtlMs ?? 30 * 60_000),
      ).toISOString(),
    });
  }

  private releaseLock(targetId: string, releaseId: string): void {
    if (this.locks.get(targetId)?.releaseId === releaseId)
      this.locks.delete(targetId);
  }

  private async withTimeout<T>(
    ms: number,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new ExecutionDeniedError(
                "TIMEOUT",
                "the deployment operation timed out",
              ),
            );
          }, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Release status advances (deploying → … → healthy): durable `put`. */
  private async save(receipt: ReleaseReceipt): Promise<ReleaseReceipt> {
    const frozen = Object.freeze({ ...receipt });
    return this.ledger.save(
      "release",
      frozen.releaseId,
      frozen.projectId,
      frozen.startedAt,
      frozen,
      "put",
    );
  }

  async deploy(
    principal: OperatorPrincipal,
    raw: unknown,
    idempotencyKey: string,
  ): Promise<ReleaseReceipt> {
    const body = onlyKeys(raw, ["projectId", "candidateId", "approvalId"]);
    const projectId = requireExecutionId(body.projectId, "projectId");
    this.authorize(principal, projectId, "deploy_release");
    const replayId = await this.ledger.claim(
      "deploy",
      principal.id,
      idempotencyKey,
      projectId,
    );
    if (replayId) {
      const replayed = await this.ledger.find<ReleaseReceipt>(
        "release",
        replayId,
      );
      if (replayed) return replayed;
    }
    try {
      const release = await this.performDeploy(principal, projectId, body);
      await this.ledger.settle(
        "deploy",
        principal.id,
        idempotencyKey,
        projectId,
        release.releaseId,
      );
      return release;
    } catch (error) {
      await this.ledger.settle(
        "deploy",
        principal.id,
        idempotencyKey,
        projectId,
      );
      throw error;
    }
  }

  private async performDeploy(
    principal: OperatorPrincipal,
    projectId: string,
    body: Record<string, unknown>,
  ): Promise<ReleaseReceipt> {
    const candidate = await this.ledger.find<DeploymentCandidate>(
      "candidate",
      requireExecutionId(body.candidateId, "candidateId"),
    );
    if (!candidate || candidate.projectId !== projectId)
      throw new NotFoundError("resource not found");
    const target = this.target(projectId, candidate.targetId);
    const policy = this.policy(projectId);
    const reqs = policy.targets[target.targetClass];
    // Stale candidate: policy changed, or its verification no longer passes.
    if (policy.version !== candidate.releasePolicyVersion)
      deny(
        "STALE_CANDIDATE",
        "the release policy changed; create a new candidate",
      );
    const verification = await this.options.verification.load(
      principal,
      candidate.verificationId,
    );
    if (
      verification.status !== "passed" ||
      verification.sourceFingerprint !== candidate.sourceFingerprint
    ) {
      deny(
        "STALE_CANDIDATE",
        "the candidate no longer matches a passed verification",
      );
    }
    if (reqs.requireReview && !candidate.reviewId)
      deny(
        "REVIEW_REQUIRED",
        `${target.targetClass} requires a reviewed change`,
      );
    const approvalId =
      typeof body.approvalId === "string"
        ? requireExecutionId(body.approvalId, "approvalId")
        : undefined;
    if (reqs.requireApproval) {
      const reason = checkBoundApproval(
        this.options.approvals,
        approvalId,
        {
          action: "release.deploy",
          projectId,
          subjectId: candidate.candidateId,
          commitSha: candidate.commitSha,
          targetId: target.targetId,
        },
        this.clock(),
      );
      if (reason) deny(reason.code, reason.detail);
    }
    const adapter =
      this.adapters.get(target.adapterId) ??
      deny("TARGET_NOT_REGISTERED", "the target adapter is not registered");
    if (reqs.requireRollbackPlan && !adapter.rollback) {
      deny(
        "ROLLBACK_UNAVAILABLE",
        `${target.targetClass} requires a rollback-capable adapter`,
      );
    }
    // EO-4.8: artifacts are re-verified right before the provider sees them;
    // a tampered or swapped artifact never reaches a deployment.
    for (const a of candidate.artifacts) {
      const record = this.options.artifacts.get(projectId, a.artifactId);
      const integrity = await this.options.artifacts
        .verify(projectId, a.artifactId)
        .catch(() => undefined);
      if (!record || record.digest.value !== a.sha256 || !integrity?.intact) {
        this.record("deployment_integrity_failed", principal.id, projectId, {
          candidateId: candidate.candidateId,
          artifactId: a.artifactId,
        });
        deny(
          "INTEGRITY_FAILED",
          `artifact ${a.path} failed its integrity check; deployment denied`,
        );
      }
    }
    const releaseId = this.newId("rel");
    this.acquireLock(target.targetId, releaseId);
    const startedAt = this.clock();
    const started = Date.now();
    let receipt: ReleaseReceipt = {
      releaseId,
      projectId,
      candidateId: candidate.candidateId,
      commitSha: candidate.commitSha,
      artifactDigests: candidate.artifacts.map((a) => a.sha256),
      targetId: target.targetId,
      targetClass: target.targetClass,
      adapterId: adapter.adapterId,
      adapterVersion: adapter.version,
      approvalIds: approvalId ? [approvalId] : [],
      releasePolicyVersion: policy.version,
      status: "deploying",
      reasons: [],
      simulated: adapter.simulated === true,
      actor: principal.id,
      startedAt,
    };
    await this.save(receipt);
    this.record("deployment_started", principal.id, projectId, {
      releaseId,
      candidateId: candidate.candidateId,
      targetId: target.targetId,
      targetClass: target.targetClass,
    });
    const finish = async (
      status: ReleaseStatus,
      reasons: ReleaseReceipt["reasons"],
      extra: Partial<ReleaseReceipt> = {},
    ) => {
      receipt = await this.save({
        ...receipt,
        ...extra,
        status,
        reasons,
        endedAt: this.clock(),
        durationMs: Date.now() - started,
      });
      this.record(
        status === "healthy"
          ? "deployment_healthy"
          : status === "deployed"
            ? "deployment_completed"
            : `deployment_${status}`,
        principal.id,
        projectId,
        {
          releaseId,
          status,
          reasonCodes: reasons.map((r) => r.code),
        },
      );
      return receipt;
    };
    try {
      const credential = target.credentialRef
        ? await (
            this.options.credentials ??
            deny(
              "DEPLOYMENT_FAILED",
              "deployment credentials cannot be resolved",
            )
          ).resolve(target.credentialRef)
        : undefined;
      const ctx = (signal: AbortSignal): DeploymentContext => ({
        candidate,
        target,
        signal,
        ...(credential ? { credential } : {}),
      });
      let providerReleaseId: string;
      let failedResources: readonly string[] = [];
      try {
        ({ providerReleaseId, failedResources = [] } = await this.withTimeout(
          target.timeoutMs,
          (signal) => adapter.deploy(ctx(signal)),
        ));
      } catch (error) {
        const timeout =
          error instanceof ExecutionDeniedError && error.code === "TIMEOUT";
        return finish("failed", [
          {
            code: timeout ? "TIMEOUT" : "DEPLOYMENT_FAILED",
            detail: timeout
              ? "the deployment timed out"
              : "the provider reported a deployment failure",
          },
        ]);
      }
      if (failedResources.length > 0) {
        // Partial deployment: some resources changed, others did not. The
        // target is in a mixed state: FAILED, with explicit recovery needs.
        const failed = target.resources.filter((r) =>
          failedResources.includes(r),
        );
        return finish(
          "failed",
          [
            {
              code: "DEPLOYMENT_FAILED",
              detail: `partial deployment: ${(failed.length > 0 ? failed : failedResources).join(", ")} failed; the target is mixed; roll back or redeploy with approval`,
            },
          ],
          {
            providerReleaseId,
            resources: {
              completed: target.resources.filter(
                (r) => !failedResources.includes(r),
              ),
              failed: failed.length > 0 ? failed : [...failedResources],
            },
          },
        );
      }
      receipt = await this.save({
        ...receipt,
        status: "deployed",
        providerReleaseId,
        resources: { completed: [...target.resources], failed: [] },
      });
      this.record("deployment_completed", principal.id, projectId, {
        releaseId,
        providerReleaseId,
      });
      if (!reqs.requirePostDeployVerification)
        return finish("deployed", [], { providerReleaseId });
      receipt = await this.save({ ...receipt, status: "verifying" });
      let check;
      try {
        check = await this.withTimeout(
          Math.min(target.timeoutMs, 120_000),
          (signal) => adapter.verify(ctx(signal)),
        );
      } catch {
        check = {
          reachable: false,
          detail: "post-deploy verification failed or timed out",
        };
      }
      const postDeploy = {
        reachable: check.reachable,
        ...(check.reportedVersion
          ? { reportedVersion: check.reportedVersion }
          : {}),
        versionMatches: check.reportedVersion === candidate.commitSha,
        checkedAt: this.clock(),
        detail: check.detail,
      };
      this.record("post_deploy_verification", principal.id, projectId, {
        releaseId,
        reachable: postDeploy.reachable,
        versionMatches: postDeploy.versionMatches,
      });
      if (!postDeploy.reachable) {
        const degraded = await finish(
          "degraded",
          [
            {
              code: "DEPLOYMENT_FAILED",
              detail: "the target is not healthy after deployment",
            },
          ],
          { providerReleaseId, postDeploy },
        );
        return reqs.automaticRollback
          ? this.autoRollback(principal, degraded)
          : degraded;
      }
      if (!postDeploy.versionMatches) {
        const failed = await finish(
          "failed",
          [
            {
              code: "DEPLOYMENT_FAILED",
              detail:
                "the target reports a different version than the candidate",
            },
          ],
          { providerReleaseId, postDeploy },
        );
        return reqs.automaticRollback
          ? this.autoRollback(principal, failed)
          : failed;
      }
      return finish("healthy", [], { providerReleaseId, postDeploy });
    } finally {
      this.releaseLock(target.targetId, releaseId);
    }
  }

  /* ---- rollback ------------------------------------------------ */

  private async lastHealthyBefore(
    release: ReleaseReceipt,
  ): Promise<ReleaseReceipt | undefined> {
    const history = await this.ledger.list<ReleaseReceipt>(
      "release",
      release.projectId,
      200,
      (r) => r.releaseId,
      (r) => r.startedAt,
    );
    return history
      .filter(
        (r) =>
          r.targetId === release.targetId &&
          r.status === "healthy" &&
          r.releaseId !== release.releaseId &&
          r.startedAt <= release.startedAt &&
          r.providerReleaseId,
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  }

  private async restore(
    principal: OperatorPrincipal,
    release: ReleaseReceipt,
    to: ReleaseReceipt,
    automatic: boolean,
  ): Promise<ReleaseReceipt> {
    const target = this.target(release.projectId, release.targetId);
    const adapter = this.adapters.get(target.adapterId);
    if (!adapter?.rollback)
      deny("ROLLBACK_UNAVAILABLE", "the target adapter cannot roll back");
    const candidate = await this.ledger.find<DeploymentCandidate>(
      "candidate",
      to.candidateId,
    );
    if (!candidate)
      deny(
        "ROLLBACK_UNAVAILABLE",
        "the previous release's candidate is unknown",
      );
    this.acquireLock(target.targetId, release.releaseId);
    try {
      this.record("rollback_started", principal.id, release.projectId, {
        releaseId: release.releaseId,
        toReleaseId: to.releaseId,
        automatic,
      });
      try {
        await this.withTimeout(target.timeoutMs, (signal) =>
          adapter!.rollback!(
            { candidate: candidate!, target, signal },
            to.providerReleaseId!,
          ),
        );
      } catch {
        // Never claim a recovery that did not happen.
        await this.save({
          ...release,
          reasons: [
            ...release.reasons,
            {
              code: "ROLLBACK_FAILED",
              detail: `rollback to ${to.releaseId} failed; the target was NOT restored`,
            },
          ],
        });
        this.record("rollback_failed", principal.id, release.projectId, {
          releaseId: release.releaseId,
          toReleaseId: to.releaseId,
          automatic,
        });
        deny(
          "ROLLBACK_FAILED",
          "the rollback failed; the target was not restored",
        );
      }
      const rolled = await this.save({
        ...release,
        status: "rolled_back",
        rollback: {
          fromReleaseId: release.releaseId,
          toReleaseId: to.releaseId,
          automatic,
        },
        endedAt: this.clock(),
      });
      this.record("rollback_completed", principal.id, release.projectId, {
        releaseId: release.releaseId,
        toReleaseId: to.releaseId,
        automatic,
      });
      return rolled;
    } finally {
      this.releaseLock(target.targetId, release.releaseId);
    }
  }

  private async autoRollback(
    principal: OperatorPrincipal,
    release: ReleaseReceipt,
  ): Promise<ReleaseReceipt> {
    const to = await this.lastHealthyBefore(release);
    if (!to) return release;
    return this.restore(principal, release, to, true);
  }

  async rollback(
    principal: OperatorPrincipal,
    raw: unknown,
  ): Promise<ReleaseReceipt> {
    const body = onlyKeys(raw, ["projectId", "releaseId", "approvalId"]);
    const projectId = requireExecutionId(body.projectId, "projectId");
    this.authorize(principal, projectId, "rollback_release");
    const release = await this.ledger.find<ReleaseReceipt>(
      "release",
      requireExecutionId(body.releaseId, "releaseId"),
    );
    if (!release || release.projectId !== projectId)
      throw new NotFoundError("resource not found");
    if (
      release.status === "rolled_back" ||
      release.status === "deploying" ||
      release.status === "verifying"
    ) {
      throw new StateTransitionError(
        `a ${release.status} release cannot be rolled back`,
      );
    }
    const reqs = this.policy(projectId).targets[release.targetClass];
    if (reqs.requireRollbackApproval) {
      const approvalId =
        typeof body.approvalId === "string" ? body.approvalId : undefined;
      const reason = checkBoundApproval(
        this.options.approvals,
        approvalId,
        {
          action: "release.rollback",
          projectId,
          subjectId: release.releaseId,
          targetId: release.targetId,
        },
        this.clock(),
      );
      if (reason) deny(reason.code, reason.detail);
    }
    const to =
      (await this.lastHealthyBefore(release)) ??
      deny(
        "ROLLBACK_UNAVAILABLE",
        "no known previous healthy release exists for this target",
      );
    return this.restore(principal, release, to!, false);
  }

  /* ---- reads --------------------------------------------------- */

  async listReleases(
    principal: OperatorPrincipal,
    projectId: string,
    limit = 50,
  ): Promise<ReleaseReceipt[]> {
    this.authorize(
      principal,
      requireExecutionId(projectId, "projectId"),
      "view",
    );
    return this.ledger.list<ReleaseReceipt>(
      "release",
      projectId,
      limit,
      (r) => r.releaseId,
      (r) => r.startedAt,
    );
  }

  listTargets(principal: OperatorPrincipal, projectId: string) {
    this.authorize(
      principal,
      requireExecutionId(projectId, "projectId"),
      "view",
    );
    return [...this.targets.values()]
      .filter((t) => t.projectId === projectId)
      .map(({ credentialRef: _c, ...safe }) => {
        void _c;
        return safe;
      });
  }
}
