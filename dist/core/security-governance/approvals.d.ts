import { type Approval, type OperatorPrincipal } from "../../contracts/index.js";
import type { ActionRequest, GovApprovalState, GovernanceApprovalView, SecurityDecision } from "../../contracts/security-governance.js";
import type { Repository } from "../../contracts/persistence.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { GovernanceLedger } from "./ledger.js";
export interface ApprovalMeta {
    id: string;
    fingerprint: string;
    consumedAt?: string;
    cancelledBy?: string;
    cancelledAt?: string;
}
export declare class GovernanceApprovalError extends Error {
    readonly code: "forbidden" | "not_found" | "invalid_state" | "invalid_request";
    constructor(code: "forbidden" | "not_found" | "invalid_state" | "invalid_request", message: string);
}
export declare function fingerprintOf(req: Pick<ActionRequest, "projectId" | "action" | "resource" | "taskId" | "agentId" | "command">): string;
export declare class GovernanceApprovals {
    private readonly approvals;
    private readonly ledger;
    private readonly clock;
    private readonly meta;
    constructor(approvals: Pick<ApprovalSystem, "request" | "get" | "list" | "decide" | "expire" | "expireStale">, meta: Repository<ApprovalMeta>, ledger: GovernanceLedger, clock: () => string);
    /** Ask a human. Returns the already-open request for the same exact action if there is one. */
    request(req: ActionRequest, decision: SecurityDecision): {
        approvalId: string;
        created: boolean;
    };
    private stateOf;
    /** Is there an unused, unexpired approval for exactly this action? */
    approvedFor(req: ActionRequest): string | undefined;
    consume(approvalId: string): void;
    view(approval: Approval): GovernanceApprovalView | undefined;
    list(filter?: {
        state?: GovApprovalState[];
        projectId?: string;
    }): GovernanceApprovalView[];
    get(approvalId: string): GovernanceApprovalView | undefined;
    private mustPending;
    /** Only a signed-in human with approve rights (and project access) decides. */
    decide(approvalId: string, decision: "approve" | "deny", principal: OperatorPrincipal, note?: string): GovernanceApprovalView;
    cancel(approvalId: string, principal: OperatorPrincipal): GovernanceApprovalView;
    expireStale(): number;
}
