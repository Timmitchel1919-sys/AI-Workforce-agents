import type { MessageKey } from "../../../i18n";

const SESSION: Record<string, MessageKey> = {
  created: "operations.statusCreated",
  validating: "operations.statusValidating",
  ready: "operations.statusReady",
  running: "operations.statusRunning",
  cancelling: "operations.statusCancelling",
  cancelled: "operations.statusCancelled",
  succeeded: "operations.statusSucceeded",
  failed: "operations.statusFailed",
  timed_out: "operations.statusTimedOut",
  denied: "operations.statusDenied",
};

const STAGE: Record<string, MessageKey> = {
  not_run: "operations.stageNotRun",
  running: "operations.stageRunning",
  passed: "operations.stagePassed",
  failed: "operations.stageFailed",
  blocked: "operations.stageBlocked",
  timed_out: "operations.stageTimedOut",
  cancelled: "operations.stageCancelled",
  error: "operations.stageError",
};

const RELEASE: Record<string, MessageKey> = {
  pending: "operations.releasePending",
  deploying: "operations.releaseDeploying",
  deployed: "operations.releaseDeployed",
  verifying: "operations.releaseVerifying",
  healthy: "operations.releaseHealthy",
  degraded: "operations.releaseDegraded",
  failed: "operations.releaseFailed",
  rolled_back: "operations.releaseRolledBack",
};

const TARGET: Record<string, MessageKey> = {
  development: "operations.classDevelopment",
  preview: "operations.classPreview",
  staging: "operations.classStaging",
  production: "operations.classProduction",
};

const ENV: Record<string, MessageKey> = {
  available: "operations.envAvailable",
  busy: "operations.envBusy",
  offline: "operations.envOffline",
  stale: "operations.envStale",
  not_configured: "operations.envNotConfigured",
  unsupported: "operations.envUnsupported",
};

const CHANGE: Record<string, MessageKey> = {
  created: "operations.changeCreated",
  modified: "operations.changeModified",
  deleted: "operations.changeDeleted",
  renamed: "operations.changeRenamed",
};

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;
const pick = (map: Record<string, MessageKey>, t: Translate, value: string) => (map[value] ? t(map[value]!) : value);

export const sessionStatusLabel = (t: Translate, v: string) => pick(SESSION, t, v);
export const stageStatusLabel = (t: Translate, v: string) => pick(STAGE, t, v);
export const releaseStatusLabel = (t: Translate, v: string) => pick(RELEASE, t, v);
export const targetClassLabel = (t: Translate, v: string) => pick(TARGET, t, v);
export const environmentStatusLabel = (t: Translate, v: string) => pick(ENV, t, v);
export const changeLabel = (t: Translate, v: string) => pick(CHANGE, t, v);

/** Tone for a status (paired with text/icon — never colour alone). */
export function tone(value: string): "ok" | "warn" | "bad" | "neutral" {
  if (["succeeded", "passed", "healthy", "available", "completed"].includes(value)) return "ok";
  if (["failed", "timed_out", "denied", "error", "degraded", "offline"].includes(value)) return "bad";
  if (["running", "cancelling", "deploying", "verifying", "busy", "blocked", "stale", "current"].includes(value)) return "warn";
  return "neutral";
}

export const shortId = (id: string, n = 10) => (id.length > n ? `${id.slice(0, n)}…` : id);
