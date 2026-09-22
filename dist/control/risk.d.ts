/**
 * Deterministic risk classification for an approval, derived from the requested
 * action string — never from model wording. State-changing / outbound actions
 * are high; anything else is medium; a pure read is low.
 */
import { type Approval, type ApprovalRiskLevel } from "../contracts/index.js";
export declare function classifyApprovalRisk(approval: Approval): ApprovalRiskLevel;
/** `true` for the risk levels a UI should ask an operator to confirm. */
export declare function requiresConfirmation(risk: ApprovalRiskLevel): boolean;
