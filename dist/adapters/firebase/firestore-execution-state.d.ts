import { type ExecutionRecordStore, type ExecutionSession, type RecordIndex } from "../../contracts/index.js";
import type { TransactionalFirestoreLike } from "./firebase-services.js";
export declare const EXECUTION_SESSIONS_COLLECTION = "execution_sessions";
export declare const EXECUTION_SESSION_KEYS_COLLECTION = "execution_session_keys";
export declare const EXECUTION_RECORDS_COLLECTION = "execution_records";
type SessionCommitResult = "committed" | "conflict";
export declare class FirestoreExecutionSessionStore {
    private readonly firestore;
    private readonly sessions;
    private readonly keys;
    constructor(firestore: TransactionalFirestoreLike, options?: {
        collectionPrefix?: string;
    });
    private parse;
    private doc;
    get(sessionId: string): Promise<ExecutionSession | undefined>;
    listByProject(projectId: string): Promise<ExecutionSession[]>;
    findByIdempotencyKey(requestedBy: string, idempotencyKey: string): Promise<ExecutionSession | undefined>;
    commit(session: ExecutionSession, expectedRevision?: number): Promise<SessionCommitResult>;
}
export declare class FirestoreExecutionRecordStore implements ExecutionRecordStore {
    private readonly firestore;
    private readonly records;
    constructor(firestore: TransactionalFirestoreLike, options?: {
        collectionPrefix?: string;
    });
    private doc;
    create(id: string, index: RecordIndex, record: unknown): Promise<void>;
    put(id: string, index: RecordIndex, record: unknown): Promise<void>;
    get<T>(id: string): Promise<T | undefined>;
    listBy<T>(field: "projectId" | "sessionId", value: string, options: {
        kind?: string;
        limit: number;
    }): Promise<T[]>;
}
export {};
