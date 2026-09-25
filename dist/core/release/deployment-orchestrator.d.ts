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
import { type ArtifactIntegrity, type ArtifactRecord, type CommitReceipt, type ExecutionRecordStore, type DeploymentAdapter, type DeploymentCandidate, type DeploymentTarget, type OperatorPrincipal, type PushReceipt, type ReleasePolicy, type ReleaseReceipt, type VerificationResult } from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { SecretValueResolver } from "./source-control-orchestrator.js";
export interface DeploymentOrchestratorOptions {
    sourceControl: {
        getPushReceipt(principal: OperatorPrincipal, projectId: string, receiptId: string): Promise<PushReceipt>;
        getCommitReceipt(principal: OperatorPrincipal, projectId: string, receiptId: string): Promise<CommitReceipt>;
    };
    verification: {
        load(principal: OperatorPrincipal, verificationId: string): Promise<VerificationResult>;
    };
    artifacts: {
        get(projectId: string, artifactId: string): ArtifactRecord | undefined;
        /** Re-digest an artifact (EO-4.8: checked again right before deploy). */
        verify(projectId: string, artifactId: string): Promise<ArtifactIntegrity>;
    };
    approvals: Pick<ApprovalSystem, "get" | "request">;
    projects: {
        has(projectId: string): boolean;
    };
    audit: AuditLog;
    credentials?: SecretValueResolver;
    /** Lock lease per target (crash-safe). Default: 30 minutes. */
    lockTtlMs?: number;
    clock?: () => string;
    idFactory?: (prefix: string) => string;
    /** EO-4.8 durable candidates, releases and idempotency reservations. */
    store?: ExecutionRecordStore;
}
export declare class DeploymentOrchestrator {
    private readonly options;
    private readonly clock;
    private readonly newId;
    private readonly targets;
    private readonly adapters;
    private readonly policies;
    private readonly locks;
    private readonly ledger;
    constructor(options: DeploymentOrchestratorOptions);
    registerAdapter(adapter: DeploymentAdapter): void;
    registerTarget(target: DeploymentTarget): void;
    setReleasePolicy(policy: ReleasePolicy): void;
    private authorize;
    private record;
    private target;
    private policy;
    createCandidate(principal: OperatorPrincipal, raw: unknown): Promise<DeploymentCandidate>;
    requestApproval(principal: OperatorPrincipal, raw: unknown): Promise<import("../../contracts/index.js").Approval>;
    private acquireLock;
    private releaseLock;
    private withTimeout;
    /** Release status advances (deploying → … → healthy): durable `put`. */
    private save;
    deploy(principal: OperatorPrincipal, raw: unknown, idempotencyKey: string): Promise<ReleaseReceipt>;
    private performDeploy;
    private lastHealthyBefore;
    private restore;
    private autoRollback;
    rollback(principal: OperatorPrincipal, raw: unknown): Promise<ReleaseReceipt>;
    listReleases(principal: OperatorPrincipal, projectId: string, limit?: number): Promise<ReleaseReceipt[]>;
    listTargets(principal: OperatorPrincipal, projectId: string): {
        targetId: string;
        projectId: string;
        targetClass: import("../../contracts/release.js").DeploymentTargetClass;
        adapterId: string;
        resources: readonly string[];
        providerRef: string;
        timeoutMs: number;
    }[];
}
