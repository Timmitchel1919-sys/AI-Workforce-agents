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
import { DEPLOYMENT_TARGET_CLASSES, ExecutionDeniedError, NotFoundError, PermissionDeniedError, StateTransitionError, ValidationError, operatorCan, operatorCanAccessProject, requireExecutionId, } from "../../contracts/index.js";
import { createId, now } from "../shared.js";
import { checkBoundApproval, requestBoundApproval, } from "./approval-binding.js";
const deny = (code, detail) => {
    throw new ExecutionDeniedError(code, detail);
};
function onlyKeys(raw, keys) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new ValidationError("request must be an object");
    for (const k of Object.keys(raw)) {
        // Refuses destinations, project ids, commands and resource lists.
        if (!keys.includes(k))
            throw new ValidationError(`unknown field ${k}`);
    }
    return raw;
}
export class DeploymentOrchestrator {
    options;
    clock;
    newId;
    targets = new Map();
    adapters = new Map();
    policies = new Map();
    candidates = new Map();
    releases = new Map();
    locks = new Map();
    idempotency = new Map();
    constructor(options) {
        this.options = options;
        this.clock = options.clock ?? now;
        this.newId = options.idFactory ?? createId;
    }
    /* ---- trusted composition ------------------------------------- */
    registerAdapter(adapter) {
        requireExecutionId(adapter.adapterId, "adapterId");
        if (this.adapters.has(adapter.adapterId))
            throw new Error(`adapter ${adapter.adapterId} already registered`);
        this.adapters.set(adapter.adapterId, adapter);
    }
    registerTarget(target) {
        requireExecutionId(target.targetId, "targetId");
        requireExecutionId(target.projectId, "projectId");
        if (!DEPLOYMENT_TARGET_CLASSES.includes(target.targetClass))
            throw new ValidationError("unknown target class");
        if (!this.adapters.has(target.adapterId))
            throw new Error(`unknown deployment adapter ${target.adapterId}`);
        if (target.resources.length === 0)
            throw new ValidationError("a target must name its resources");
        if (!Number.isInteger(target.timeoutMs) ||
            target.timeoutMs <= 0 ||
            target.timeoutMs > 3_600_000) {
            throw new ValidationError("target.timeoutMs must be bounded");
        }
        if (this.targets.has(target.targetId))
            throw new Error(`target ${target.targetId} already registered`);
        this.targets.set(target.targetId, Object.freeze({ ...target, resources: [...target.resources] }));
    }
    setReleasePolicy(policy) {
        requireExecutionId(policy.projectId, "projectId");
        for (const cls of DEPLOYMENT_TARGET_CLASSES) {
            if (!policy.targets[cls])
                throw new ValidationError(`release policy lacks ${cls}`);
        }
        this.policies.set(policy.projectId, Object.freeze({ ...policy }));
    }
    /* ---- helpers --------------------------------------------------- */
    authorize(principal, projectId, capability) {
        if (!operatorCanAccessProject(principal, projectId) ||
            !this.options.projects.has(projectId)) {
            throw new NotFoundError("resource not found");
        }
        if (!operatorCan(principal, capability)) {
            throw new PermissionDeniedError(`operator ${principal.id} lacks the ${capability} capability`);
        }
    }
    record(action, actor, projectId, data) {
        this.options.audit.record("execution_event", {
            projectId,
            data: { ...data, action, actor },
        });
    }
    target(projectId, targetId) {
        const target = this.targets.get(targetId);
        // Another project's target and an unknown target look the same.
        if (!target || target.projectId !== projectId) {
            deny("TARGET_NOT_REGISTERED", "the deployment target is not registered for this project");
        }
        return target;
    }
    policy(projectId) {
        return (this.policies.get(projectId) ??
            deny("POLICY_DENIED", "no release policy governs this project"));
    }
    /* ---- candidate ----------------------------------------------- */
    createCandidate(principal, raw) {
        const body = onlyKeys(raw, [
            "projectId",
            "pushReceiptId",
            "targetId",
            "artifactIds",
        ]);
        const projectId = requireExecutionId(body.projectId, "projectId");
        this.authorize(principal, projectId, "deploy_release");
        const push = this.options.sourceControl.getPushReceipt(principal, projectId, requireExecutionId(body.pushReceiptId, "pushReceiptId"));
        const target = this.target(projectId, requireExecutionId(body.targetId, "targetId"));
        const policy = this.policy(projectId);
        // Provenance: the commit receipt behind the push (verification, source).
        const provenance = this.options.sourceControl.getCommitReceipt(principal, projectId, push.commitReceiptId);
        const artifactIds = Array.isArray(body.artifactIds)
            ? body.artifactIds.map((a, i) => requireExecutionId(a, `artifactIds[${i}]`))
            : [];
        const artifacts = artifactIds.map((id) => this.options.artifacts.get(projectId, id) ??
            deny("STALE_CANDIDATE", `artifact ${id} is not recorded for this project`));
        const sources = new Set(artifacts.map((a) => a.sourceFingerprint));
        const verificationIds = new Set(artifacts.map((a) => a.verificationId));
        if (sources.size > 1 || verificationIds.size > 1) {
            deny("STALE_CANDIDATE", "artifacts come from different source states");
        }
        const verification = this.options.verification.get(principal, provenance.verificationId);
        if (verification.status !== "passed" ||
            verification.sourceFingerprint !== provenance.sourceFingerprint) {
            deny("STALE_CANDIDATE", "the verification behind this commit is not a pass for its source");
        }
        if (artifacts.length > 0 &&
            ([...sources][0] !== provenance.sourceFingerprint ||
                [...verificationIds][0] !== provenance.verificationId)) {
            deny("STALE_CANDIDATE", "artifacts were not produced by this commit's verification");
        }
        const candidate = Object.freeze({
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
            artifacts: Object.freeze(artifacts.map((a) => ({
                artifactId: a.artifactId,
                path: a.path,
                sha256: a.digest.value,
            }))),
            targetId: target.targetId,
            releasePolicyVersion: policy.version,
            createdBy: principal.id,
            createdAt: this.clock(),
        });
        this.candidates.set(candidate.candidateId, candidate);
        this.record("deployment_candidate_created", principal.id, projectId, {
            candidateId: candidate.candidateId,
            commitSha: candidate.commitSha,
            targetId: target.targetId,
            targetClass: target.targetClass,
        });
        return candidate;
    }
    requestApproval(principal, raw) {
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
            const c = this.candidates.get(subjectId);
            if (!c || c.projectId !== projectId)
                throw new NotFoundError("resource not found");
            return requestBoundApproval(this.options.approvals, {
                action: "release.deploy",
                projectId,
                subjectId,
                commitSha: c.commitSha,
                targetId: c.targetId,
            }, principal.id, String(body.reason ?? ""));
        }
        if (body.operation === "rollback") {
            this.authorize(principal, projectId, "rollback_release");
            const r = this.releases.get(subjectId);
            if (!r || r.projectId !== projectId)
                throw new NotFoundError("resource not found");
            return requestBoundApproval(this.options.approvals, {
                action: "release.rollback",
                projectId,
                subjectId,
                targetId: r.targetId,
            }, principal.id, String(body.reason ?? ""));
        }
        throw new ValidationError("operation must be deploy or rollback");
    }
    /* ---- deploy -------------------------------------------------- */
    acquireLock(targetId, releaseId) {
        const held = this.locks.get(targetId);
        if (held && Date.parse(held.expiresAt) > Date.parse(this.clock())) {
            deny("DEPLOYMENT_LOCKED", "another deployment to this target is in progress");
        }
        this.locks.set(targetId, {
            releaseId,
            expiresAt: new Date(Date.parse(this.clock()) + (this.options.lockTtlMs ?? 30 * 60_000)).toISOString(),
        });
    }
    releaseLock(targetId, releaseId) {
        if (this.locks.get(targetId)?.releaseId === releaseId)
            this.locks.delete(targetId);
    }
    async withTimeout(ms, run) {
        const controller = new AbortController();
        let timer;
        try {
            return await Promise.race([
                run(controller.signal),
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        controller.abort();
                        reject(new ExecutionDeniedError("TIMEOUT", "the deployment operation timed out"));
                    }, ms);
                }),
            ]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    save(receipt) {
        const frozen = Object.freeze({ ...receipt });
        this.releases.set(frozen.releaseId, frozen);
        return frozen;
    }
    async deploy(principal, raw, idempotencyKey) {
        const body = onlyKeys(raw, ["projectId", "candidateId", "approvalId"]);
        const projectId = requireExecutionId(body.projectId, "projectId");
        this.authorize(principal, projectId, "deploy_release");
        const key = `${principal.id}\u0000${requireExecutionId(idempotencyKey, "idempotencyKey")}`;
        const previous = this.idempotency.get(key);
        if (previous)
            return this.releases.get(previous);
        const candidate = this.candidates.get(requireExecutionId(body.candidateId, "candidateId"));
        if (!candidate || candidate.projectId !== projectId)
            throw new NotFoundError("resource not found");
        const target = this.target(projectId, candidate.targetId);
        const policy = this.policy(projectId);
        const reqs = policy.targets[target.targetClass];
        // Stale candidate: policy changed, or its verification no longer passes.
        if (policy.version !== candidate.releasePolicyVersion)
            deny("STALE_CANDIDATE", "the release policy changed; create a new candidate");
        const verification = this.options.verification.get(principal, candidate.verificationId);
        if (verification.status !== "passed" ||
            verification.sourceFingerprint !== candidate.sourceFingerprint) {
            deny("STALE_CANDIDATE", "the candidate no longer matches a passed verification");
        }
        if (reqs.requireReview && !candidate.reviewId)
            deny("REVIEW_REQUIRED", `${target.targetClass} requires a reviewed change`);
        const approvalId = typeof body.approvalId === "string"
            ? requireExecutionId(body.approvalId, "approvalId")
            : undefined;
        if (reqs.requireApproval) {
            const reason = checkBoundApproval(this.options.approvals, approvalId, {
                action: "release.deploy",
                projectId,
                subjectId: candidate.candidateId,
                commitSha: candidate.commitSha,
                targetId: target.targetId,
            }, this.clock());
            if (reason)
                deny(reason.code, reason.detail);
        }
        const adapter = this.adapters.get(target.adapterId) ??
            deny("TARGET_NOT_REGISTERED", "the target adapter is not registered");
        if (reqs.requireRollbackPlan && !adapter.rollback) {
            deny("ROLLBACK_UNAVAILABLE", `${target.targetClass} requires a rollback-capable adapter`);
        }
        const releaseId = this.newId("rel");
        this.acquireLock(target.targetId, releaseId);
        const startedAt = this.clock();
        const started = Date.now();
        let receipt = {
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
        this.idempotency.set(key, releaseId);
        this.save(receipt);
        this.record("deployment_started", principal.id, projectId, {
            releaseId,
            candidateId: candidate.candidateId,
            targetId: target.targetId,
            targetClass: target.targetClass,
        });
        const finish = (status, reasons, extra = {}) => {
            receipt = this.save({
                ...receipt,
                ...extra,
                status,
                reasons,
                endedAt: this.clock(),
                durationMs: Date.now() - started,
            });
            this.record(status === "healthy"
                ? "deployment_healthy"
                : status === "deployed"
                    ? "deployment_completed"
                    : `deployment_${status}`, principal.id, projectId, {
                releaseId,
                status,
                reasonCodes: reasons.map((r) => r.code),
            });
            return receipt;
        };
        try {
            const credential = target.credentialRef
                ? await (this.options.credentials ??
                    deny("DEPLOYMENT_FAILED", "deployment credentials cannot be resolved")).resolve(target.credentialRef)
                : undefined;
            const ctx = (signal) => ({
                candidate,
                target,
                signal,
                ...(credential ? { credential } : {}),
            });
            let providerReleaseId;
            try {
                ({ providerReleaseId } = await this.withTimeout(target.timeoutMs, (signal) => adapter.deploy(ctx(signal))));
            }
            catch (error) {
                const timeout = error instanceof ExecutionDeniedError && error.code === "TIMEOUT";
                return finish("failed", [
                    {
                        code: timeout ? "TIMEOUT" : "DEPLOYMENT_FAILED",
                        detail: timeout
                            ? "the deployment timed out"
                            : "the provider reported a deployment failure",
                    },
                ]);
            }
            receipt = this.save({
                ...receipt,
                status: "deployed",
                providerReleaseId,
            });
            this.record("deployment_completed", principal.id, projectId, {
                releaseId,
                providerReleaseId,
            });
            if (!reqs.requirePostDeployVerification)
                return finish("deployed", [], { providerReleaseId });
            receipt = this.save({ ...receipt, status: "verifying" });
            let check;
            try {
                check = await this.withTimeout(Math.min(target.timeoutMs, 120_000), (signal) => adapter.verify(ctx(signal)));
            }
            catch {
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
                const degraded = finish("degraded", [
                    {
                        code: "DEPLOYMENT_FAILED",
                        detail: "the target is not healthy after deployment",
                    },
                ], { providerReleaseId, postDeploy });
                return reqs.automaticRollback
                    ? this.autoRollback(principal, degraded)
                    : degraded;
            }
            if (!postDeploy.versionMatches) {
                const failed = finish("failed", [
                    {
                        code: "DEPLOYMENT_FAILED",
                        detail: "the target reports a different version than the candidate",
                    },
                ], { providerReleaseId, postDeploy });
                return reqs.automaticRollback
                    ? this.autoRollback(principal, failed)
                    : failed;
            }
            return finish("healthy", [], { providerReleaseId, postDeploy });
        }
        finally {
            this.releaseLock(target.targetId, releaseId);
        }
    }
    /* ---- rollback ------------------------------------------------ */
    lastHealthyBefore(release) {
        return [...this.releases.values()]
            .filter((r) => r.targetId === release.targetId &&
            r.status === "healthy" &&
            r.releaseId !== release.releaseId &&
            r.startedAt <= release.startedAt &&
            r.providerReleaseId)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    }
    async restore(principal, release, to, automatic) {
        const target = this.target(release.projectId, release.targetId);
        const adapter = this.adapters.get(target.adapterId);
        if (!adapter?.rollback)
            deny("ROLLBACK_UNAVAILABLE", "the target adapter cannot roll back");
        const candidate = this.candidates.get(to.candidateId);
        this.acquireLock(target.targetId, release.releaseId);
        try {
            this.record("rollback_started", principal.id, release.projectId, {
                releaseId: release.releaseId,
                toReleaseId: to.releaseId,
                automatic,
            });
            await this.withTimeout(target.timeoutMs, (signal) => adapter.rollback({ candidate, target, signal }, to.providerReleaseId));
            const rolled = this.save({
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
        }
        finally {
            this.releaseLock(target.targetId, release.releaseId);
        }
    }
    async autoRollback(principal, release) {
        const to = this.lastHealthyBefore(release);
        if (!to)
            return release;
        return this.restore(principal, release, to, true);
    }
    async rollback(principal, raw) {
        const body = onlyKeys(raw, ["projectId", "releaseId", "approvalId"]);
        const projectId = requireExecutionId(body.projectId, "projectId");
        this.authorize(principal, projectId, "rollback_release");
        const release = this.releases.get(requireExecutionId(body.releaseId, "releaseId"));
        if (!release || release.projectId !== projectId)
            throw new NotFoundError("resource not found");
        if (release.status === "rolled_back" ||
            release.status === "deploying" ||
            release.status === "verifying") {
            throw new StateTransitionError(`a ${release.status} release cannot be rolled back`);
        }
        const reqs = this.policy(projectId).targets[release.targetClass];
        if (reqs.requireRollbackApproval) {
            const approvalId = typeof body.approvalId === "string" ? body.approvalId : undefined;
            const reason = checkBoundApproval(this.options.approvals, approvalId, {
                action: "release.rollback",
                projectId,
                subjectId: release.releaseId,
                targetId: release.targetId,
            }, this.clock());
            if (reason)
                deny(reason.code, reason.detail);
        }
        const to = this.lastHealthyBefore(release) ??
            deny("ROLLBACK_UNAVAILABLE", "no known previous healthy release exists for this target");
        return this.restore(principal, release, to, false);
    }
    /* ---- reads --------------------------------------------------- */
    listReleases(principal, projectId, limit = 50) {
        this.authorize(principal, requireExecutionId(projectId, "projectId"), "view");
        return [...this.releases.values()]
            .filter((r) => r.projectId === projectId)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, Math.min(Math.max(1, limit), 200));
    }
    listTargets(principal, projectId) {
        this.authorize(principal, requireExecutionId(projectId, "projectId"), "view");
        return [...this.targets.values()]
            .filter((t) => t.projectId === projectId)
            .map(({ credentialRef: _c, ...safe }) => {
            void _c;
            return safe;
        });
    }
}
