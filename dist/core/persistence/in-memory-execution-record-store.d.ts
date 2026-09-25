/**
 * EO-4.8 in-memory ExecutionRecordStore (tests and local runs). Same
 * semantics as the Firestore store: create-only records, JSON copies,
 * newest-first bounded lookups.
 */
import { type ExecutionRecordStore, type RecordIndex } from "../../contracts/index.js";
export declare class InMemoryExecutionRecordStore implements ExecutionRecordStore {
    private readonly records;
    create(id: string, index: RecordIndex, record: unknown): Promise<void>;
    put(id: string, index: RecordIndex, record: unknown): Promise<void>;
    get<T>(id: string): Promise<T | undefined>;
    listBy<T>(field: "projectId" | "sessionId", value: string, options: {
        kind?: string;
        limit: number;
    }): Promise<T[]>;
    get size(): number;
}
