import type { MessageKey } from "../../../i18n";
import type { AuditSeverity, BudgetStatus } from "../../../features/costCenter";

const BUDGET_STATUS: Record<BudgetStatus, MessageKey> = {
  not_configured: "costCenter.statusNotConfigured",
  ok: "costCenter.statusOk",
  warning: "costCenter.statusWarning",
  blocked: "costCenter.statusBlocked",
  unpriced: "costCenter.statusUnpriced",
};

const BUDGET_TONE: Record<BudgetStatus, "ok" | "warn" | "bad" | "neutral"> = {
  not_configured: "neutral",
  ok: "ok",
  warning: "warn",
  blocked: "bad",
  unpriced: "warn",
};

const SEVERITY: Record<AuditSeverity, MessageKey> = {
  info: "auditFindings.severityInfo",
  warning: "auditFindings.severityWarning",
  critical: "auditFindings.severityCritical",
};

const SEVERITY_TONE: Record<AuditSeverity, "ok" | "warn" | "bad" | "neutral"> = {
  info: "neutral",
  warning: "warn",
  critical: "bad",
};

const SCOPE: Record<"daily" | "monthly" | "task", MessageKey> = {
  daily: "costCenter.scopeDaily",
  monthly: "costCenter.scopeMonthly",
  task: "costCenter.scopeTask",
};

const RULE: Record<string, MessageKey> = {
  release_without_verification: "auditFindings.ruleReleaseWithoutVerification",
  release_without_approval: "auditFindings.ruleReleaseWithoutApproval",
  high_risk_session_unapproved: "auditFindings.ruleHighRiskSessionUnapproved",
  usage_unpriced: "auditFindings.ruleUsageUnpriced",
};

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export const budgetStatusLabel = (t: Translate, status: BudgetStatus) => t(BUDGET_STATUS[status]);
export const budgetStatusTone = (status: BudgetStatus) => BUDGET_TONE[status];
export const auditSeverityLabel = (t: Translate, severity: AuditSeverity) => t(SEVERITY[severity]);
export const auditSeverityTone = (severity: AuditSeverity) => SEVERITY_TONE[severity];
export const scopeLabel = (t: Translate, scope: "daily" | "monthly" | "task") => t(SCOPE[scope]);
export const ruleLabel = (t: Translate, ruleId: string) => (RULE[ruleId] ? t(RULE[ruleId]!) : ruleId);

/**
 * USD formatter that never rounds a real, non-zero priced amount down to
 * "$0.00" — per-token fractional-cent charges are common here, and showing
 * $0.00 for anything but a truly zero cost would be a fabrication.
 */
export function formatUsd(amountUsd: number): string {
  if (amountUsd === 0) return "$0.00";
  if (Math.abs(amountUsd) < 0.01) return `$${amountUsd.toFixed(4)}`;
  return `$${amountUsd.toFixed(2)}`;
}
