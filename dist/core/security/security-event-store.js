import { validateSecurityEvent } from "../../contracts/index.js";
function select(events, query = {}) {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 100);
    return events
        .filter((event) => !query.projectId || event.projectId === query.projectId)
        .filter((event) => !query.category || event.category === query.category)
        .filter((event) => !query.severity || event.severity === query.severity)
        .filter((event) => !query.outcome || event.outcome === query.outcome)
        .filter((event) => !query.after || event.occurredAt > query.after)
        .filter((event) => !query.before || event.occurredAt < query.before)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, limit)
        .map((event) => structuredClone(event));
}
export class AppendOnlySecurityEventStore {
    events = new Map();
    append(event) {
        validateSecurityEvent(event);
        if (this.events.has(event.eventId))
            throw new Error(`security event already exists: ${event.eventId}`);
        this.events.set(event.eventId, structuredClone(event));
    }
    query(query = {}) {
        return select([...this.events.values()], query);
    }
}
export class RepositorySecurityEventStore {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    append(event) {
        validateSecurityEvent(event);
        if (this.repository.findById(event.eventId))
            throw new Error(`security event already exists: ${event.eventId}`);
        this.repository.upsert(structuredClone(event));
    }
    query(query = {}) {
        return select(this.repository.list(), query);
    }
}
