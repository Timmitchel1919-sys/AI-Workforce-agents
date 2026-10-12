import type { Alert, AlertSeverity, EmergencyState, Policy, PolicyConditions } from "../types";

export const ALL_PROJECTS = "all";

/** Alerts that are no longer being worked on. */
const CLOSED = new Set(["RESOLVED", "FALSE_POSITIVE"]);
export const isClosed = (status: string): boolean => CLOSED.has(status);

const SEVERITY_RANK: Record<AlertSeverity, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
const rank = (severity: string): number => SEVERITY_RANK[severity as AlertSeverity] ?? 0;

/** CRITICAL/HIGH alerts that are still unresolved are pinned to the top. */
export function isPinned(alert: Pick<Alert, "severity" | "status">): boolean {
  return (alert.severity === "CRITICAL" || alert.severity === "HIGH") && !isClosed(alert.status);
}

/** Pinned alerts first (most severe, then newest); the rest newest first. Pure ordering of server data. */
export function splitAlerts(alerts: readonly Alert[]): { pinned: Alert[]; rest: Alert[] } {
  const newest = (a: Alert, b: Alert) => b.createdAt.localeCompare(a.createdAt);
  const pinned = alerts.filter(isPinned).sort((a, b) => rank(b.severity) - rank(a.severity) || newest(a, b));
  const rest = alerts.filter((a) => !isPinned(a)).sort(newest);
  return { pinned, rest };
}

/** Which emergency controls the UI offers per state. Recovery is controlled and never automatic. */
export function emergencyControls(state: EmergencyState): { stop: boolean; investigate: boolean; recover: boolean; resume: boolean } {
  return {
    stop: state === "NORMAL",
    investigate: state === "PAUSED",
    recover: state === "PAUSED" || state === "INVESTIGATING",
    resume: state === "RECOVERY_REQUIRED",
  };
}

export function splitList(text: string): string[] {
  return [...new Set(text.split(",").map((s) => s.trim()).filter((s) => s.length > 0))];
}

/** Merges the form-managed condition fields onto the existing conditions, preserving every field the form does not edit. */
export function mergeConditions(
  existing: PolicyConditions | undefined,
  form: { actions: string[]; environments: string[]; resourceIncludes: string[]; minCount: string; minRisk: string },
): PolicyConditions {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  const setOrDrop = (key: string, value: unknown, keep: boolean) => {
    if (keep) next[key] = value;
    else delete next[key];
  };
  setOrDrop("actions", form.actions, form.actions.length > 0);
  setOrDrop("environments", form.environments, form.environments.length > 0);
  setOrDrop("resourceIncludes", form.resourceIncludes, form.resourceIncludes.length > 0);
  const count = Number(form.minCount);
  setOrDrop("minCount", count, form.minCount.trim() !== "" && Number.isFinite(count) && count > 0);
  setOrDrop("minRisk", form.minRisk, form.minRisk !== "");
  return next as PolicyConditions;
}

export function scopeText(scope: Policy["scope"]): string {
  return Object.entries(scope)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

export type ToneName = "neutral" | "success" | "warning" | "danger" | "info";
const RISK_TONE: Record<string, ToneName> = { LOW: "success", MEDIUM: "info", HIGH: "warning", CRITICAL: "danger", INFO: "neutral" };
export const riskTone = (value: string): ToneName => RISK_TONE[value] ?? "neutral";
