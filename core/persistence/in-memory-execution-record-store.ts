/**
 * EO-4.8 in-memory ExecutionRecordStore (tests and local runs). Same
 * semantics as the Firestore store: create-only records, JSON copies,
 * newest-first bounded lookups.
 */
import {
  MAX_RECORD_PAGE,
  RecordExistsError,
  type ExecutionRecordStore,
  type RecordIndex,
} from "../../contracts/index.js";

export class InMemoryExecutionRecordStore implements ExecutionRecordStore {
  private readonly records = new Map<string, RecordIndex & { json: string }>();

  async create(id: string, index: RecordIndex, record: unknown): Promise<void> {
    if (this.records.has(id)) throw new RecordExistsError(id);
    this.records.set(id, { ...index, json: JSON.stringify(record) });
  }

  async put(id: string, index: RecordIndex, record: unknown): Promise<void> {
    this.records.set(id, { ...index, json: JSON.stringify(record) });
  }

  async get<T>(id: string): Promise<T | undefined> {
    const doc = this.records.get(id);
    return doc ? (JSON.parse(doc.json) as T) : undefined;
  }

  async listBy<T>(
    field: "projectId" | "sessionId",
    value: string,
    options: { kind?: string; limit: number },
  ): Promise<T[]> {
    return [...this.records.values()]
      .filter(
        (d) => d[field] === value && (!options.kind || d.kind === options.kind),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(Math.max(1, options.limit), MAX_RECORD_PAGE))
      .map((d) => JSON.parse(d.json) as T);
  }

  get size(): number {
    return this.records.size;
  }
}
