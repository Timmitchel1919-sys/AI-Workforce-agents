import { type Approval } from "../../contracts/index.js";
import { createId, now } from "../shared.js";
export class ApprovalSystem {
  private readonly approvals = new Map<string, Approval>();
  request(input: Pick<Approval, "requestedBy" | "action" | "reason" | "expiresAt">): Approval { const approval: Approval = { id: createId("approval"), ...input, status: "requested", requestedAt: now(), decisionMetadata: {} }; this.approvals.set(approval.id, approval); return approval; }
  decide(id: string, decision: "approved" | "rejected", decidedBy: string, metadata: Record<string, unknown> = {}): Approval { const approval = this.required(id); if (approval.status !== "requested") throw new Error("approval is not pending"); const next = { ...approval, status: decision, decidedBy, decidedAt: now(), decisionMetadata: metadata }; this.approvals.set(id, next); return next; }
  expire(id: string): Approval { const approval = this.required(id); if (approval.status !== "requested") throw new Error("approval is not pending"); const next = { ...approval, status: "expired" as const, decidedAt: now() }; this.approvals.set(id, next); return next; }
  private required(id: string): Approval { const approval = this.approvals.get(id); if (!approval) throw new Error(`unknown approval: ${id}`); return approval; }
}
