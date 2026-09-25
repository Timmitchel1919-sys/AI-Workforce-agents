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
import { type CommitReceipt, type ExecutionRecordStore, type GovernedGitPort, type OperatorPrincipal, type PullRequestPort, type PullRequestRecord, type PushReceipt, type RepositoryPolicy, type ReviewRecord, type ReviewStatus, type SecretReference, type StageSet, type WorkspaceControl, type WorkspaceFilePolicy } from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ExecutionManager } from "../execution/execution-manager.js";
import type { VerificationService } from "../execution/verification-service.js";
import { requestBoundApproval } from "./approval-binding.js";
export interface SecretValueResolver {
    resolve(ref: SecretReference): Promise<string>;
}
export interface SourceControlOrchestratorOptions {
    git: GovernedGitPort;
    verification: Pick<VerificationService, "load">;
    manager: Pick<ExecutionManager, "getSession" | "getChangeSet">;
    workspaceControl: Pick<WorkspaceControl, "sourceFingerprint">;
    approvals: Pick<ApprovalSystem, "get" | "request">;
    projects: {
        has(projectId: string): boolean;
    };
    audit: AuditLog;
    credentials?: SecretValueResolver;
    pullRequests?: PullRequestPort;
    filePolicy?: WorkspaceFilePolicy;
    clock?: () => string;
    idFactory?: (prefix: string) => string;
    /** EO-4.8 durable records + idempotency reservations. */
    store?: ExecutionRecordStore;
}
/** Commit summaries are data: one bounded line, no control characters. */
export declare function sanitizeSummary(value: unknown): string;
export declare class SourceControlOrchestrator {
    private readonly options;
    private readonly clock;
    private readonly newId;
    private readonly policies;
    private readonly ledger;
    constructor(options: SourceControlOrchestratorOptions);
    /** Trusted composition only. */
    setRepositoryPolicy(policy: RepositoryPolicy): void;
    private policy;
    private authorize;
    private record;
    /** Verification must have PASSED, be terminal and carry a ChangeSet. */
    private passedVerification;
    /** The CURRENT source must equal the verified source. */
    private assertSourceUnchanged;
    private storeReview;
    private authorsOf;
    /** An operator review (`review_change`). */
    submitReview(principal: OperatorPrincipal, raw: unknown): Promise<ReviewRecord>;
    /**
     * A reviewer-AGENT review, recorded by trusted orchestration (the agent
     * never calls this directly). The authoring agent can never review.
     */
    recordAgentReview(principal: OperatorPrincipal, input: {
        projectId: string;
        verificationId: string;
        reviewerAgentId: string;
        status: ReviewStatus;
        summary?: string;
    }): Promise<ReviewRecord>;
    prepareStageSet(principal: OperatorPrincipal, raw: unknown): Promise<StageSet>;
    /** Request an approval bound to one stage set / commit (operators decide it). */
    requestApproval(principal: OperatorPrincipal, raw: unknown): Promise<ReturnType<typeof requestBoundApproval>>;
    commit(principal: OperatorPrincipal, raw: unknown, idempotencyKey: string): Promise<CommitReceipt>;
    private performCommit;
    /** Branch policy decides where a commit may go (never the caller). */
    private pushBranch;
    push(principal: OperatorPrincipal, raw: unknown, idempotencyKey: string): Promise<PushReceipt>;
    private performPush;
    getCommitReceipt(principal: OperatorPrincipal, projectId: string, receiptId: string): Promise<CommitReceipt>;
    getPushReceipt(principal: OperatorPrincipal, projectId: string, receiptId: string): Promise<PushReceipt>;
    /** Live + durable source-control activity for one project, bounded. */
    activity(principal: OperatorPrincipal, projectId: string, limit?: number): Promise<{
        reviews: ReviewRecord[];
        stageSets: StageSet[];
        commits: CommitReceipt[];
        pushes: PushReceipt[];
        pullRequests: PullRequestRecord[];
    }>;
}
