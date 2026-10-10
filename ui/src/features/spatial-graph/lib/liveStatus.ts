/**
 * Honest live-transport status (EO-5.6). The status is derived ONLY from what
 * the transport actually did — never from whether an animation is playing, and
 * never "live" for a manual-only refresh. ANIMATION != STATE.
 */
export const LIVE_STATUSES = ["live", "refreshing", "reconnecting", "degraded", "paused", "offline"] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** Bounded by construction: interval, backoff, failure threshold and history are all capped. */
export const LIVE_LIMITS = {
  intervalMs: 5_000,
  maxBackoffMs: 30_000,
  /** Consecutive failures before the view is labelled degraded (still showing last-known data). */
  degradedAfterFailures: 3,
  maxTransitions: 100,
} as const;

export interface LiveInputs {
  /** Polling is wanted at all (signed in, project selected, live enabled). */
  enabled: boolean;
  online: boolean;
  hidden: boolean;
  /** A visible (initial / manual / resume) request is in flight. */
  busy: boolean;
  consecutiveFailures: number;
  /** At least one authoritative snapshot has been confirmed. */
  hasConfirmed: boolean;
}

export function deriveLiveStatus(i: LiveInputs): LiveStatus {
  if (!i.enabled || !i.online) return "offline";
  if (i.consecutiveFailures >= LIVE_LIMITS.degradedAfterFailures) return "degraded";
  if (i.consecutiveFailures > 0) return "reconnecting";
  if (i.hidden) return "paused";
  if (i.busy || !i.hasConfirmed) return "refreshing";
  return "live";
}

/** Exponential backoff from the base interval, capped. Failures reset on the next success. */
export function nextDelayMs(consecutiveFailures: number, intervalMs: number = LIVE_LIMITS.intervalMs): number {
  const factor = 2 ** Math.min(Math.max(consecutiveFailures, 0), 6);
  return Math.min(intervalMs * factor, Math.max(LIVE_LIMITS.maxBackoffMs, intervalMs));
}
