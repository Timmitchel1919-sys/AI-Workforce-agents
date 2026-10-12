import { TRUST_RANK, TRUST_STATES, type Connector, type ExplorerRow, type McpCapabilityRow } from "../types";

export const ALL_PROJECTS = "all";

export type ToneName = "neutral" | "success" | "warning" | "danger" | "info";

const STATUS_TONE: Record<string, ToneName> = {
  HEALTHY: "success", DEGRADED: "warning", ERROR: "danger", CONNECTED: "info", CONFIGURED: "neutral",
  DISCOVERED: "neutral", DISCONNECTED: "neutral", DISABLED: "neutral",
};
export const statusTone = (status: string): ToneName => STATUS_TONE[status] ?? "neutral";

/** A connector may only be described as working when the server says HEALTHY, or DEGRADED (always with a warning). */
export const isWorking = (status: string): boolean => status === "HEALTHY" || status === "DEGRADED";

export type ConnectionNote = "healthy" | "degraded" | "error" | "disabled" | "connectedUnverified" | "configured" | "notConnected" | "unknown";

/** Which honest sentence describes this connector's connection state. Never implies a connector works unless HEALTHY. */
export function connectionNote(c: Pick<Connector, "status" | "enabled" | "auth">): ConnectionNote {
  switch (c.status) {
    case "HEALTHY": return "healthy";
    case "DEGRADED": return "degraded";
    case "ERROR": return "error";
    case "DISABLED": return "disabled";
    case "CONNECTED": return "connectedUnverified";
    case "CONFIGURED": return "configured";
    case "DISCOVERED":
    case "DISCONNECTED": return "notConnected";
    default: return "unknown";
  }
}

const RISK_TONE: Record<string, ToneName> = { LOW: "success", MEDIUM: "info", HIGH: "warning", CRITICAL: "danger" };
export const riskTone = (value: string): ToneName => RISK_TONE[value] ?? "neutral";

const OUTCOME_TONE: Record<string, ToneName> = {
  SUCCESS: "success", SIMULATED: "info", QUEUED: "info", WAITING_APPROVAL: "warning", DENIED: "danger", BLOCKED: "danger", FAILED: "danger",
};
export const outcomeTone = (value: string): ToneName => OUTCOME_TONE[value] ?? "neutral";

const EVENT_TONE: Record<string, ToneName> = { TRIGGERED: "success", RECEIVED: "info", IGNORED: "neutral", REJECTED: "danger", FAILED: "danger" };
export const eventTone = (value: string): ToneName => EVENT_TONE[value] ?? "neutral";

/** Trust states an operator may move a connector to: never above the current rank (raising trust is administrator-only). */
export function trustAllowed(current: string, target: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return (TRUST_RANK[target] ?? 0) <= (TRUST_RANK[current] ?? 0);
}
export const trustChoices = (): readonly string[] => TRUST_STATES;

/** Server sandbox text -> catalogue key, or null for a free-form "substitute with X". */
export function sandboxKey(text: unknown): "allowed" | "blocked" | null {
  if (text === "allowed" || text === "ALLOW") return "allowed";
  if (text === "blocked" || text === "DENY") return "blocked";
  return null;
}
export function sandboxSubstitute(raw: unknown): string | null {
  if (typeof raw === "string") {
    const m = /^substitute with (.+)$/.exec(raw);
    return m ? (m[1] ?? null) : null;
  }
  if (raw && typeof raw === "object" && "substitute" in raw) {
    const s = (raw as { substitute: unknown }).substitute;
    return typeof s === "string" ? s : null;
  }
  return null;
}

export interface ExplorerEntry {
  capability: string;
  description: string;
  operation: string;
  risk: string;
  approval: string;
  mcp: boolean;
  providers: { connectorId: string; provider: string; status: string; mode: string; trust: string; unavailable?: string; sandbox: unknown }[];
  /** true / false when a project is selected, null otherwise. */
  mapped: boolean | null;
  available: boolean;
}

/** Groups the per-provider rows by capability so "which providers provide it" is one entry. Pure reshaping of server data. */
export function groupCapabilities(rows: readonly ExplorerRow[], mcp: readonly McpCapabilityRow[], projectSelected: boolean): ExplorerEntry[] {
  const byName = new Map<string, ExplorerEntry>();
  for (const r of rows) {
    let entry = byName.get(r.capability);
    if (!entry) {
      entry = {
        capability: r.capability, description: r.description, operation: r.operation, risk: r.risk, approval: r.approval,
        mcp: false, providers: [], mapped: projectSelected ? false : null, available: false,
      };
      byName.set(r.capability, entry);
    }
    entry.providers.push({
      connectorId: r.connectorId, provider: r.provider, status: r.status, mode: r.mode, trust: r.trust,
      ...(r.unavailable ? { unavailable: r.unavailable } : {}), sandbox: r.sandbox,
    });
    if (!r.unavailable) entry.available = true;
    if (projectSelected && r.mappedToProject) entry.mapped = true;
  }
  for (const m of mcp) {
    byName.set(m.capability, {
      capability: m.capability, description: m.description, operation: m.operation, risk: m.risk, approval: m.approval,
      mcp: true,
      providers: m.providers.map((p) => ({ connectorId: p.connectorId, provider: p.provider, status: p.status, mode: p.mode, trust: p.trust, sandbox: null })),
      mapped: projectSelected ? true : null,
      available: m.available,
    });
  }
  return [...byName.values()].sort((a, b) => a.capability.localeCompare(b.capability));
}

export type ParsedParams = { ok: true; value: Record<string, unknown> } | { ok: false };

/** Simulator parameters: empty means none; otherwise a JSON object (not an array or a primitive). */
export function parseParams(text: string): ParsedParams {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value && typeof value === "object" && !Array.isArray(value)) return { ok: true, value: value as Record<string, unknown> };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface Condition { field: string; equals: string | number | boolean }

/** One `field=value` per line. `true`/`false` and numbers are typed; anything else stays a string. */
export function parseConditions(text: string): Condition[] | null {
  const out: Condition[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const at = line.indexOf("=");
    if (at <= 0) return null;
    const field = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (field === "" || value === "") return null;
    let equals: string | number | boolean = value;
    if (value === "true") equals = true;
    else if (value === "false") equals = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) equals = Number(value);
    out.push({ field, equals });
  }
  return out;
}

export function splitList(text: string): string[] {
  return [...new Set(text.split(",").map((s) => s.trim()).filter((s) => s.length > 0))];
}

/** Display text for a primitive summary value. */
export const summaryValue = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

