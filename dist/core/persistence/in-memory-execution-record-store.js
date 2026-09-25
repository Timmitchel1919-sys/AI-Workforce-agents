/**
 * EO-4.8 in-memory ExecutionRecordStore (tests and local runs). Same
 * semantics as the Firestore store: create-only records, JSON copies,
 * newest-first bounded lookups.
 */
import { MAX_RECORD_PAGE, RecordExistsError, } from "../../contracts/index.js";
export class InMemoryExecutionRecordStore {
    records = new Map();
    async create(id, index, record) {
        if (this.records.has(id))
            throw new RecordExistsError(id);
        this.records.set(id, { ...index, json: JSON.stringify(record) });
    }
    async put(id, index, record) {
        this.records.set(id, { ...index, json: JSON.stringify(record) });
    }
    async get(id) {
        const doc = this.records.get(id);
        return doc ? JSON.parse(doc.json) : undefined;
    }
    async listBy(field, value, options) {
        return [...this.records.values()]
            .filter((d) => d[field] === value && (!options.kind || d.kind === options.kind))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, Math.min(Math.max(1, options.limit), MAX_RECORD_PAGE))
            .map((d) => JSON.parse(d.json));
    }
    get size() {
        return this.records.size;
    }
}
