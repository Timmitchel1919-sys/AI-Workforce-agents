import { type Approval, type ApprovalRequestDraft, type Repository } from "../../contracts/index.js";
/**
 * Human approval records.
 *
 *   requested ─▶ approved
 *             ├▶ rejected
 *             └▶ expired
 *
 * This system only records decisions; it never grants tool or project access
 * by itself and never auto-approves. A UI or API layer drives `decide` /
 * `expire`. State is held in the injected {@link Repository} (in-memory by
 * default).
 */
export declare class ApprovalSystem {
    private readonly repo;
    constructor(repo?: Repository<Approval>);
    request(draft: ApprovalRequestDraft): Approval;
    get(id: string): Approval | undefined;
    require(id: string): Approval;
    list(): Approval[];
    pending(): Approval[];
    decide(id: string, decision: "approved" | "rejected", decidedBy: string, metadata?: Record<string, unknown>): Approval;
    expire(id: string): Approval;
    /** Expire every pending approval whose expiry is at or before `asOf`. */
    expireStale(asOf?: string): Approval[];
    private mustBePending;
}
