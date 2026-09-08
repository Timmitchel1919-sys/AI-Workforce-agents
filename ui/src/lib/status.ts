/**
 * One status vocabulary for every domain (agents, tasks, workflows, approvals,
 * projects, health). Components read `describeStatus(raw)` — they never invent
 * per-feature colour logic. Colours resolve to `--status-*` tokens.
 */
export type StatusTone =
  "neutral" | "info" | "success" | "warning" | "danger" | "muted";

export interface StatusDescriptor {
  /** The raw status key, kebab/underscore normalized. */
  key: string;
  /** Human label. */
  label: string;
  tone: StatusTone;
  /** CSS custom property to colour the dot/badge with. */
  cssVar: string;
  /** Whether the state is "live" (animate the dot). */
  live: boolean;
}

const TONE_BY_KEY: Record<string, StatusTone> = {
  // agents
  available: "success",
  busy: "info",
  idle: "muted",
  waiting: "warning",
  // tasks
  queued: "neutral",
  created: "neutral",
  running: "info",
  awaiting_approval: "warning",
  blocked: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "muted",
  // workflows
  pending: "neutral",
  planned: "neutral",
  paused: "warning",
  // approvals
  requested: "warning",
  approved: "success",
  rejected: "danger",
  expired: "muted",
  // projects
  active: "success",
  archived: "muted",
  // health
  healthy: "success",
  degraded: "warning",
  unavailable: "danger",
  unknown: "neutral",
  disabled: "muted",
  ok: "success",
};

const LIVE_KEYS = new Set(["running", "busy"]);

export function describeStatus(raw: string): StatusDescriptor {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const tone = TONE_BY_KEY[key] ?? "neutral";
  const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    key,
    label,
    tone,
    cssVar: `var(--status-${key}, var(--color-neutral))`,
    live: LIVE_KEYS.has(key),
  };
}

export type RiskLevel = "low" | "medium" | "high";

export function describeRisk(level: string): {
  level: RiskLevel;
  label: string;
  cssVar: string;
} {
  const normalized = level.trim().toLowerCase();
  const resolved: RiskLevel =
    normalized === "high" || normalized === "medium" ? normalized : "low";
  return {
    level: resolved,
    label: `${resolved[0]!.toUpperCase()}${resolved.slice(1)} risk`,
    cssVar: `var(--risk-${resolved})`,
  };
}
