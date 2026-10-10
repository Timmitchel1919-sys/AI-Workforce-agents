import type {
  CanonicalSecurityEvent,
  SecurityEventCategory,
  SecurityEventOutcome,
  SecurityEventSeverity,
} from "../../contracts/index.js";
const SECRET_KEYS =
  /api[-_]?key|authorization|password|secret|token|credential/i;
const SECRET_VALUE =
  /(sk-[A-Za-z0-9_-]+|Bearer\s+\S+|ghp_[A-Za-z0-9_]+|AIza[\w-]+)/g;
function redact(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(SECRET_VALUE, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEYS.test(key) ? "[REDACTED]" : redact(entry),
      ]),
    );
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
