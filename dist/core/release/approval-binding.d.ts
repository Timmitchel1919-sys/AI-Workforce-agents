/**
 * EO-4.6 approval binding. REVIEW ≠ APPROVAL: an approval authorizes ONE
 * protected action on ONE exact subject. The binding travels in the
 * approval's metadata when it is requested; an approval whose binding does
 * not match exactly (other project, source, commit, branch, target or
 * operation) authorizes nothing — so stale approvals never carry over.
 */
import { type Approval, type ExecutionReason } from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
export type ReleaseApprovalAction = "release.commit" | "release.push" | "release.deploy" | "release.rollback";
export interface ApprovalBinding {
    action: ReleaseApprovalAction;
    projectId: string;
    /** Stage set / commit receipt / candidate / release id. */
    subjectId: string;
    sourceFingerprint?: string;
    commitSha?: string;
    branch?: string;
    targetId?: string;
}
/** Create a PENDING approval bound to exactly this action + subject. */
export declare function requestBoundApproval(approvals: Pick<ApprovalSystem, "request">, binding: ApprovalBinding, requestedBy: string, reason: string): Approval;
/** undefined = the approval authorizes exactly this binding. */
export declare function checkBoundApproval(approvals: Pick<ApprovalSystem, "get">, approvalId: string | undefined, binding: ApprovalBinding, now: string): ExecutionReason | undefined;
