import type {
  AuditEvent,
  CanonicalSecurityEvent,
} from "../../contracts/index.js";
import { normalizeSecurityEvent } from "./security-event-normalizer.js";

const SECURITY_AUDIT_TYPES = new Set<AuditEvent["type"]>([
  "permission_decision",
  "approval_requested",
  "approval_decided",
  "tool_execution",
  "agent_activity",
  "access_event",
]);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function projectAuditEvent(
  event: AuditEvent,
): CanonicalSecurityEvent | undefined {
  if (!SECURITY_AUDIT_TYPES.has(event.type)) return undefined;
  const data = event.data;
  const outcome =
    data.outcome === "allowed" || data.outcome === "approved"
      ? "allowed"
      : data.outcome === "denied" || data.outcome === "rejected"
        ? "denied"
        : data.outcome === "blocked"
          ? "blocked"
          : data.outcome === "failed"
            ? "failed"
            : "observed";
  const category =
    event.type === "permission_decision" || event.type === "access_event"
      ? "authorization"
      : event.type.startsWith("approval")
        ? "policy"
        : event.type === "tool_execution"
          ? "agent_security"
          : "system";
  const severity =
    data.severity === "critical" || data.risk === "critical"
      ? "critical"
      : data.severity === "high" || data.risk === "high"
        ? "high"
        : data.severity === "medium" || data.risk === "medium"
          ? "medium"
          : "info";
  return normalizeSecurityEvent({
    eventId: `security_${event.id}`,
    occurredAt: event.timestamp,
    category,
    type: event.type,
    severity,
    outcome,
    actor: { kind: event.agentId ? "agent" : "system", id: event.agentId },
    source: { kind: "workforce-audit", id: "audit-log" },
    projectId: event.projectId,
    correlationId: text(data.correlationId),
    approvalId: text(data.approvalId),
    policyId: text(data.policyId),
    evidence: data,
  });
}
