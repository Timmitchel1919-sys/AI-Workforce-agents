import {
  type AuditEvent,
  type AuditEventType,
  type AuditSink,
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
 * in-memory for Phase 1) and are also retained here for querying.
 */
export class AuditLog {
  private readonly sink: AuditSink;
  private readonly events: AuditEvent[] = [];

  constructor(sink: AuditSink = new InMemoryAuditSink()) {
    this.sink = sink;
  }

  record(type: AuditEventType, fields: AuditEventFields): AuditEvent {
    const event: AuditEvent = {
      id: createId("audit"),
      type,
      timestamp: now(),
      taskId: fields.taskId,
      agentId: fields.agentId,
      projectId: fields.projectId,
      data: { ...fields.data },
    };
    this.events.push(event);
    this.sink.write(event);
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
