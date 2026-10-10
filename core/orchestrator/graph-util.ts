/**
 * Leaf helpers shared by the projection engine and its fragment builders.
 * This module imports nothing from the graph modules, so there is no cycle.
 */

const MAX_META_STRING = 200;
const MAX_LIST_ITEMS = 10;

/**
 * Free text (task/step/agent descriptions) is user-authored, so obvious
 * credential shapes are scrubbed before it can appear on a graph node.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g,
  /\b(api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*\S+/gi,
];

export function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS)
    out = out.replace(pattern, "[redacted]");
  return out;
}

export function truncate(value: string, max: number): string {
  const clean = redactSecrets(value);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Only display-safe scalar metadata survives; undefined entries are dropped. */
export function safeMetadata(
  input: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (value === undefined) continue;
    out[key] =
      typeof value === "string" ? truncate(value, MAX_META_STRING) : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function joinList(
  values: readonly string[] | undefined,
): string | undefined {
  if (!values || values.length === 0) return undefined;
  const shown = values.slice(0, MAX_LIST_ITEMS).join(", ");
  return values.length > MAX_LIST_ITEMS
    ? `${shown} (+${values.length - MAX_LIST_ITEMS})`
    : shown;
}

export const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
