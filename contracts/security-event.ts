import type { Entity } from "./persistence.js";

export const SECURITY_EVENT_CATEGORIES = [
  "authentication",
  "authorization",
  "policy",
  "data_protection",
  "agent_security",
  "system",
] as const;
export type SecurityEventCategory = (typeof SECURITY_EVENT_CATEGORIES)[number];
export const SECURITY_EVENT_SEVERITIES = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type SecurityEventSeverity = (typeof SECURITY_EVENT_SEVERITIES)[number];
export const SECURITY_EVENT_OUTCOMES = [
  "allowed",
  "denied",
  "blocked",
  "failed",
  "observed",
] as const;
export type SecurityEventOutcome = (typeof SECURITY_EVENT_OUTCOMES)[number];
export interface CanonicalSecurityEvent extends Entity {
  eventId: string;
  schemaVersion: 1;
  occurredAt: string;
  category: SecurityEventCategory;
  type: string;
  severity: SecurityEventSeverity;
  outcome: SecurityEventOutcome;
  actor: { kind: string; id?: string };
  source: { kind: string; id?: string; ip?: string };
  target?: { kind: string; id?: string; projectId?: string };
  projectId?: string;
  correlationId?: string;
  approvalId?: string;
  policyId?: string;
  evidence?: Readonly<Record<string, unknown>>;
  previousEventHash?: string;
  eventHash?: string;
}
export interface SecurityEventQuery {
  projectId?: string;
  category?: SecurityEventCategory;
  severity?: SecurityEventSeverity;
  outcome?: SecurityEventOutcome;
  after?: string;
  before?: string;
  limit?: number;
}
export function validateSecurityEvent(event: CanonicalSecurityEvent): void {
  if (!event.id || !event.eventId || event.id !== event.eventId)
    throw new Error("security event id must equal eventId");
  if (event.schemaVersion !== 1)
    throw new Error("unsupported security event schema");
  if (!event.occurredAt || Number.isNaN(Date.parse(event.occurredAt)))
    throw new Error("security event occurredAt must be an ISO timestamp");
  if (!event.category || !event.type || !event.severity || !event.outcome)
    throw new Error("security event identity fields are required");
  if (!event.actor.kind || !event.source.kind)
    throw new Error("security event actor and source are required");
}
