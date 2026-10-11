import type { Tone } from "../components/common";

export const healthTone = (s: string): Tone => (s === "HEALTHY" || s === "ACTIVE" || s === "OK" || s === "ACHIEVED" || s === "ON_TRACK" ? "success" : s === "AT_RISK" || s === "WARN" || s === "UPDATE_AVAILABLE" || s === "AT_RISK" || s === "NEEDS_APPROVAL" ? "warning" : s === "CRITICAL" || s === "BLOCKED" || s === "BAD" || s === "FAILED" || s === "INCOMPATIBLE" || s === "OFF_TRACK" || s === "CONFLICT" || s === "SERIOUS" ? "danger" : "neutral");
export const riskTone = (r: string): Tone => (r === "LOW" ? "success" : r === "MEDIUM" ? "warning" : "danger");
export const stateTone = (s: string): Tone =>
  ["COMPLETED", "SUCCEEDED", "APPROVED", "ADOPTED", "ENABLED", "ACHIEVED", "MEASURED"].includes(s) ? "success"
  : ["FAILED", "ESCALATED", "REJECTED", "BLOCKED", "CANCELLED", "DISABLED"].includes(s) ? "danger"
  : ["AWAITING_APPROVAL", "AWAITING_PLAN_APPROVAL", "WAITING_APPROVAL", "RECOVERING", "RETRY_WAIT", "PAUSED", "OPEN", "PROPOSED"].includes(s) ? "warning"
  : "neutral";
export const qualityTone = (q: string): Tone => (q === "ESTABLISHED" ? "success" : q === "LOW_CONFIDENCE" ? "warning" : "neutral");

export const pct = (rate: { value: number | null; numerator: number; denominator: number }): string =>
  rate.value === null ? "—" : `${Math.round(rate.value * 100)}% (${rate.numerator}/${rate.denominator})`;
export const ms = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  if (value < 60_000) return `${Math.round(value / 1000)} s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} min`;
  return `${(value / 3_600_000).toFixed(1)} h`;
};
/** A null amount means "not priced", never zero. */
export const usd = (value: number | null | undefined): string | null => (value === null || value === undefined ? null : `$${value.toFixed(value < 1 ? 4 : 2)}`);
export const num = (value: number): string => value.toLocaleString("en-US");
