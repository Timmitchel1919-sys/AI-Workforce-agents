import {
  type AuditEvent,
  type AuditEventType,
  type AuditSink,
  type Repository,
} from "../../contracts/index.js";
import { createId, now } from "../shared.js";

/** Default local sink. Keeps events in memory for the life of the process. */
export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  write(event: AuditEvent): void {
    this.events.push(event);
  }
}

export interface AuditQuery {
  type?: AuditEventType;
  taskId?: string;
  agentId?: string;
  projectId?: string;
}

export type AuditEventFields = Omit<AuditEvent, "id" | "type" | "timestamp">;

/**
 * Structured audit log. Writes go to a pluggable {@link AuditSink} (local and
 * in-memory by default), are retained here for querying, and — when a
 * {@link Repository} is supplied — are persisted durably as well.
 */
export class AuditLog {
  private readonly sink: AuditSink;
  private readonly repo: Repository<AuditEvent> | undefined;
  private readonly events: AuditEvent[] = [];

  constructor(
    sink: AuditSink = new InMemoryAuditSink(),
    repository?: Repository<AuditEvent>,
  ) {
    this.sink = sink;
    this.repo = repository;
    if (repository) {
      for (const event of repository.list()) this.events.push(event);
    }
  }

  record(type: AuditEventType, fields: AuditEventFields): AuditEvent {
    // `createId` is deliberately process-local. A serverless cold start resets its sequence while
    // the repository survives, so skip every durable id that already exists instead of overwriting
    // an audit record (or colliding with an append-only OperationalAuditSink observation).
    let id = createId("audit");
    while (this.events.some((event) => event.id === id) || this.repo?.findById(id)) {
      id = createId("audit");
    }
    const event: AuditEvent = {
      id,
      type,
      timestamp: now(),
      taskId: fields.taskId,
      agentId: fields.agentId,
      projectId: fields.projectId,
      data: { ...fields.data },
    };
    this.events.push(event);
    this.sink.write(event);
    this.repo?.upsert(event);
    return event;
  }

  list(): readonly AuditEvent[] {
    return [...this.events];
  }

  query(filter: AuditQuery): AuditEvent[] {
    return this.events.filter(
      (event) =>
        (filter.type === undefined || event.type === filter.type) &&
        (filter.taskId === undefined || event.taskId === filter.taskId) &&
        (filter.agentId === undefined || event.agentId === filter.agentId) &&
        (filter.projectId === undefined ||
          event.projectId === filter.projectId),
    );
  }
}
