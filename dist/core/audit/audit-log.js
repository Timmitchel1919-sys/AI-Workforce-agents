import { createId, now } from "../shared.js";
/** Default local sink. Keeps events in memory for the life of the process. */
export class InMemoryAuditSink {
    events = [];
    write(event) {
        this.events.push(event);
    }
}
/**
 * Structured audit log. Writes go to a pluggable {@link AuditSink} (local and
 * in-memory by default), are retained here for querying, and — when a
 * {@link Repository} is supplied — are persisted durably as well.
 */
export class AuditLog {
    sink;
    repo;
    events = [];
    constructor(sink = new InMemoryAuditSink(), repository) {
        this.sink = sink;
        this.repo = repository;
        if (repository) {
            for (const event of repository.list())
                this.events.push(event);
        }
    }
    record(type, fields) {
        const event = {
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
        this.repo?.upsert(event);
        return event;
    }
    list() {
        return [...this.events];
    }
    query(filter) {
        return this.events.filter((event) => (filter.type === undefined || event.type === filter.type) &&
            (filter.taskId === undefined || event.taskId === filter.taskId) &&
            (filter.agentId === undefined || event.agentId === filter.agentId) &&
            (filter.projectId === undefined ||
                event.projectId === filter.projectId));
    }
}
