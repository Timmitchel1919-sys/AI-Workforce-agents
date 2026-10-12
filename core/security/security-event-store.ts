import type {
  CanonicalSecurityEvent,
  Repository,
  SecurityEventQuery,
} from "../../contracts/index.js";
import { validateSecurityEvent } from "../../contracts/index.js";
export interface SecurityEventStore {
  append(event: CanonicalSecurityEvent): void;
  query(query?: SecurityEventQuery): CanonicalSecurityEvent[];
}

export type { AsyncSecurityEventStore } from "../../contracts/security-event.js";
function select(
  events: CanonicalSecurityEvent[],
  query: SecurityEventQuery = {},
): CanonicalSecurityEvent[] {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 100);
  return events
    .filter((event) => !query.projectId || event.projectId === query.projectId)
    .filter((event) => !query.category || event.category === query.category)
    .filter((event) => !query.severity || event.severity === query.severity)
    .filter((event) => !query.outcome || event.outcome === query.outcome)
    .filter((event) => !query.type || event.type === query.type)
    .filter((event) => !query.actorId || event.actor?.id === query.actorId)
    .filter(
      (event) =>
        !query.agentId ||
        (event.actor?.kind === "agent" && event.actor?.id === query.agentId),
    )
    .filter(
      (event) =>
        !query.correlationId || event.correlationId === query.correlationId,
    )
    .filter(
      (event) => !query.approvalId || event.approvalId === query.approvalId,
    )
    .filter(
      (event) =>
        !query.destructiveActionId ||
        (event.evidence as Record<string, unknown> | undefined)?.[
          "destructiveActionId"
        ] === query.destructiveActionId,
    )
    .filter(
      (event) =>
        !query.incidentId ||
        (event.evidence as Record<string, unknown> | undefined)?.[
          "incidentId"
        ] === query.incidentId,
    )
    .filter((event) => !query.targetId || event.target?.id === query.targetId)
    .filter((event) => !query.after || event.occurredAt > query.after!)
    .filter((event) => !query.before || event.occurredAt < query.before!)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit)
    .map((event) => structuredClone(event));
}
export class AppendOnlySecurityEventStore implements SecurityEventStore {
  private readonly events = new Map<string, CanonicalSecurityEvent>();
  append(event: CanonicalSecurityEvent): void {
    validateSecurityEvent(event);
    if (this.events.has(event.eventId))
      throw new Error(`security event already exists: ${event.eventId}`);
    this.events.set(event.eventId, structuredClone(event));
  }
  query(query: SecurityEventQuery = {}): CanonicalSecurityEvent[] {
    return select([...this.events.values()], query);
  }
}
export class RepositorySecurityEventStore implements SecurityEventStore {
  constructor(
    private readonly repository: Repository<CanonicalSecurityEvent>,
  ) {}
  append(event: CanonicalSecurityEvent): void {
    validateSecurityEvent(event);
    if (this.repository.findById(event.eventId))
      throw new Error(`security event already exists: ${event.eventId}`);
    this.repository.upsert(structuredClone(event));
  }
  query(query: SecurityEventQuery = {}): CanonicalSecurityEvent[] {
    return select(this.repository.list(), query);
  }
}
