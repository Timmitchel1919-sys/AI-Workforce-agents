import { type AuditEvent, type AuditEventType, type AuditSink, type Repository } from "../../contracts/index.js";
/** Default local sink. Keeps events in memory for the life of the process. */
export declare class InMemoryAuditSink implements AuditSink {
    readonly events: AuditEvent[];
    write(event: AuditEvent): void;
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
export declare class AuditLog {
    private readonly sink;
    private readonly repo;
    private readonly events;
    constructor(sink?: AuditSink, repository?: Repository<AuditEvent>);
    record(type: AuditEventType, fields: AuditEventFields): AuditEvent;
    list(): readonly AuditEvent[];
    query(filter: AuditQuery): AuditEvent[];
}
