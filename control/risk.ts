/**
 * Deterministic risk classification for an approval, derived from the requested
 * action string — never from model wording. State-changing / outbound actions
 * are high; anything else is medium; a pure read is low.
 */
import { type Approval, type ApprovalRiskLevel } from "../contracts/index.js";

const HIGH_RISK =
  /(write|deploy|delete|remove|external_communication|secret_access|publish|commit|push|merge|production|prod\b|payment|transfer)/i;
const LOW_RISK =
  /(read|view|list|inspect|search|fetch|status|summary|describe)/i;

export function classifyApprovalRisk(approval: Approval): ApprovalRiskLevel {
  const haystack = `${approval.action} ${approval.reason}`;
  if (HIGH_RISK.test(haystack)) return "high";
  if (LOW_RISK.test(haystack)) return "low";
  return "medium";
}

/** `true` for the risk levels a UI should ask an operator to confirm. */
export function requiresConfirmation(risk: ApprovalRiskLevel): boolean {
  return risk === "high";
}
