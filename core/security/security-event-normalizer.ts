import type {
  CanonicalSecurityEvent,
  SecurityEventCategory,
  SecurityEventOutcome,
  SecurityEventSeverity,
} from "../../contracts/index.js";

/**
 * Keys whose value is replaced with `[REDACTED]` regardless of
 * content. Matched case-insensitively against the full key name.
 */
const SECRET_KEYS =
  /^(password|passphrase|access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|token|authorization|cookie|private[-_]?key|service[-_]?account[-_]?key|client[-_]?secret|api[-_]?key|webhook[-_]?secret|credential|credentials|secret|secret[-_]?value)$/i;

/**
 * In-string patterns that LOOK like a secret even in free text. We
 * deliberately avoid a generic "long base64 run" heuristic because it
 * false-positives on ordinary long identifiers and audit payloads;
 * known-shape tokens (`sk-…`, `Bearer …`, `ghp_…`, `AIza…`, PEM key
 * blocks, JWTs) are enumerated instead.
 */
const SECRET_VALUE =
  /(sk-[A-Za-z0-9_-]{10,}|rk_[A-Za-z0-9_-]{10,}|Bearer\s+\S+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|AIza[\w-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----)/g;

/**
 * Hard upper bounds on evidence payloads. These exist so a careless
 * caller cannot write an unbounded blob into the append-only store.
 * The redactor TRUNCATES (and marks with `__truncated__`) rather than
 * refusing — losing an event is worse than losing part of it.
 */
export const SECURITY_EVENT_LIMITS = {
  maxDepth: 6,
  maxArrayItems: 64,
  maxStringLength: 2048,
  maxEvidenceKeys: 64,
} as const;

function redact(value: unknown, depth = 0): unknown {
  if (depth > SECURITY_EVENT_LIMITS.maxDepth) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") {
    const scrubbed = value.replace(SECRET_VALUE, "[REDACTED]");
    return scrubbed.length > SECURITY_EVENT_LIMITS.maxStringLength
      ? scrubbed.slice(0, SECURITY_EVENT_LIMITS.maxStringLength) +
          "…[TRUNCATED]"
      : scrubbed;
  }
  if (Array.isArray(value)) {
    const limit = SECURITY_EVENT_LIMITS.maxArrayItems;
    const slice = value.slice(0, limit).map((v) => redact(v, depth + 1));
    if (value.length > limit) slice.push("[TRUNCATED_ARRAY]");
    return slice;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const limit = SECURITY_EVENT_LIMITS.maxEvidenceKeys;
    const kept = entries
      .slice(0, limit)
      .map(([key, entry]) => [
        key,
        SECRET_KEYS.test(key) ? "[REDACTED]" : redact(entry, depth + 1),
      ]);
    const result = Object.fromEntries(kept);
    if (entries.length > limit) {
      (result as Record<string, unknown>).__truncated__ = true;
    }
    return result;
  }
  return value;
}
export interface SecurityEventInput {
  eventId: string;
  occurredAt?: string;
  category: SecurityEventCategory;
  type: string;
  severity: SecurityEventSeverity;
  outcome: SecurityEventOutcome;
  actor: CanonicalSecurityEvent["actor"];
  source: CanonicalSecurityEvent["source"];
  target?: CanonicalSecurityEvent["target"];
  projectId?: string;
  correlationId?: string;
  approvalId?: string;
  policyId?: string;
  evidence?: Readonly<Record<string, unknown>>;
}
export function normalizeSecurityEvent(
  input: SecurityEventInput,
): CanonicalSecurityEvent {
  return {
    id: input.eventId,
    eventId: input.eventId,
    schemaVersion: 1,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    category: input.category,
    type: input.type,
    severity: input.severity,
    outcome: input.outcome,
    actor: redact(input.actor) as CanonicalSecurityEvent["actor"],
    source: redact(input.source) as CanonicalSecurityEvent["source"],
    target: redact(input.target) as CanonicalSecurityEvent["target"],
    projectId: input.projectId,
    correlationId: input.correlationId,
    approvalId: input.approvalId,
    policyId: input.policyId,
    evidence: redact(input.evidence) as Readonly<Record<string, unknown>>,
  };
}
