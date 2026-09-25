/**
 * EO-4.8 Firestore persistence for execution state (Admin SDK only; client
 * rules stay deny-all).
 *
 *   execution_sessions/{sessionId}        session (revisioned, CAS updates)
 *   execution_session_keys/{sha256}       idempotency key → sessionId
 *   execution_records/{recordId}          immutable/advancing evidence records
 *
 * Sessions are read from Firestore on every access and every update is a
 * TRANSACTION that re-reads the stored revision: two Function instances can
 * never both win a transition (the loser gets `conflict`, nothing written).
 * Payloads are stored as JSON strings next to top-level index fields, so
 * Firestore type limits (undefined values, nested arrays) never corrupt
 * evidence. Lookups are single-field equality queries (automatic indexes).
 */
import { createHash } from "node:crypto";
import {
  MAX_RECORD_PAGE,
  RecordExistsError,
  type ExecutionRecordStore,
  type ExecutionSession,
  type RecordIndex,
} from "../../contracts/index.js";
import type {
  FirestoreQueryableCollectionLike,
  TransactionalFirestoreLike,
} from "./firebase-services.js";

export const EXECUTION_SESSIONS_COLLECTION = "execution_sessions";
export const EXECUTION_SESSION_KEYS_COLLECTION = "execution_session_keys";
export const EXECUTION_RECORDS_COLLECTION = "execution_records";

type SessionCommitResult = "committed" | "conflict";

class PreconditionFailed extends Error {}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

/** Firestore document ids may not contain "/"; hash anything unbounded. */
const docId = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class FirestoreExecutionSessionStore {
  private readonly sessions: FirestoreQueryableCollectionLike;
  private readonly keys: FirestoreQueryableCollectionLike;

  constructor(
    private readonly firestore: TransactionalFirestoreLike,
    options: { collectionPrefix?: string } = {},
  ) {
    const prefix = options.collectionPrefix ?? "";
    this.sessions = firestore.collection(
      prefix + EXECUTION_SESSIONS_COLLECTION,
    );
    this.keys = firestore.collection(
      prefix + EXECUTION_SESSION_KEYS_COLLECTION,
    );
  }

  private parse(
    data: Record<string, unknown> | undefined,
  ): ExecutionSession | undefined {
    return typeof data?.json === "string"
      ? (JSON.parse(data.json) as ExecutionSession)
      : undefined;
  }

  private doc(session: ExecutionSession): Record<string, unknown> {
    return {
      sessionId: session.sessionId,
      projectId: session.projectId,
      status: session.status,
      revision: session.revision,
      createdAt: session.createdAt,
      json: JSON.stringify(session),
    };
  }

  async get(sessionId: string): Promise<ExecutionSession | undefined> {
    return this.parse((await this.sessions.doc(docId(sessionId)).get()).data());
  }

  async listByProject(projectId: string): Promise<ExecutionSession[]> {
    const snap = await this.sessions.where("projectId", "==", projectId).get();
    return snap.docs
      .map((d) => this.parse(d.data()))
      .filter((s): s is ExecutionSession => s !== undefined)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          a.sessionId.localeCompare(b.sessionId),
      );
  }

  async findByIdempotencyKey(
    requestedBy: string,
    idempotencyKey: string,
  ): Promise<ExecutionSession | undefined> {
    const key = await this.keys
      .doc(docId(`${requestedBy}\u0000${idempotencyKey}`))
      .get();
    const sessionId = key.data()?.sessionId;
    return typeof sessionId === "string" ? this.get(sessionId) : undefined;
  }

  async commit(
    session: ExecutionSession,
    expectedRevision?: number,
  ): Promise<SessionCommitResult> {
    const sessionRef = this.sessions.doc(docId(session.sessionId));
    const keyRef = this.keys.doc(
      docId(`${session.requestedBy}\u0000${session.idempotencyKey}`),
    );
    try {
      await this.firestore.runTransaction(async (tx) => {
        const current = await tx.get(sessionRef);
        if (expectedRevision === undefined) {
          const key = await tx.get(keyRef);
          if (current.exists || key.exists) throw new PreconditionFailed();
          tx.create(sessionRef, this.doc(session));
          tx.create(keyRef, {
            sessionId: session.sessionId,
            requestedBy: session.requestedBy,
          });
          return;
        }
        const stored = this.parse(current.data());
        if (!stored || stored.revision !== expectedRevision)
          throw new PreconditionFailed();
        tx.set(sessionRef, this.doc(session));
      });
      return "committed";
    } catch (error) {
      if (error instanceof PreconditionFailed || isAlreadyExists(error))
        return "conflict";
      throw error;
    }
  }
}

export class FirestoreExecutionRecordStore implements ExecutionRecordStore {
  private readonly records: FirestoreQueryableCollectionLike;

  constructor(
    private readonly firestore: TransactionalFirestoreLike,
    options: { collectionPrefix?: string } = {},
  ) {
    this.records = firestore.collection(
      (options.collectionPrefix ?? "") + EXECUTION_RECORDS_COLLECTION,
    );
  }

  private doc(
    id: string,
    index: RecordIndex,
    record: unknown,
  ): Record<string, unknown> {
    return {
      recordId: id,
      projectId: index.projectId,
      kind: index.kind,
      createdAt: index.createdAt,
      ...(index.sessionId ? { sessionId: index.sessionId } : {}),
      json: JSON.stringify(record),
    };
  }

  async create(id: string, index: RecordIndex, record: unknown): Promise<void> {
    const ref = this.records.doc(docId(id));
    try {
      await this.firestore.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) throw new PreconditionFailed();
        tx.create(ref, this.doc(id, index, record));
      });
    } catch (error) {
      if (error instanceof PreconditionFailed || isAlreadyExists(error))
        throw new RecordExistsError(id);
      throw error;
    }
  }

  async put(id: string, index: RecordIndex, record: unknown): Promise<void> {
    await this.records.doc(docId(id)).set(this.doc(id, index, record));
  }

  async get<T>(id: string): Promise<T | undefined> {
    const data = (await this.records.doc(docId(id)).get()).data();
    return typeof data?.json === "string"
      ? (JSON.parse(data.json) as T)
      : undefined;
  }

  async listBy<T>(
    field: "projectId" | "sessionId",
    value: string,
    options: { kind?: string; limit: number },
  ): Promise<T[]> {
    const snap = await this.records.where(field, "==", value).get();
    return snap.docs
      .map((d) => d.data())
      .filter(
        (d) =>
          typeof d.json === "string" &&
          (!options.kind || d.kind === options.kind),
      )
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.min(Math.max(1, options.limit), MAX_RECORD_PAGE))
      .map((d) => JSON.parse(d.json as string) as T);
  }
}
