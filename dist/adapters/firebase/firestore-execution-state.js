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
import { MAX_RECORD_PAGE, RecordExistsError, } from "../../contracts/index.js";
export const EXECUTION_SESSIONS_COLLECTION = "execution_sessions";
export const EXECUTION_SESSION_KEYS_COLLECTION = "execution_session_keys";
export const EXECUTION_RECORDS_COLLECTION = "execution_records";
class PreconditionFailed extends Error {
}
function isAlreadyExists(error) {
    if (!error || typeof error !== "object")
        return false;
    const code = error.code;
    return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}
/** Firestore document ids may not contain "/"; hash anything unbounded. */
const docId = (value) => createHash("sha256").update(value).digest("hex");
export class FirestoreExecutionSessionStore {
    firestore;
    sessions;
    keys;
    constructor(firestore, options = {}) {
        this.firestore = firestore;
        const prefix = options.collectionPrefix ?? "";
        this.sessions = firestore.collection(prefix + EXECUTION_SESSIONS_COLLECTION);
        this.keys = firestore.collection(prefix + EXECUTION_SESSION_KEYS_COLLECTION);
    }
    parse(data) {
        return typeof data?.json === "string"
            ? JSON.parse(data.json)
            : undefined;
    }
    doc(session) {
        return {
            sessionId: session.sessionId,
            projectId: session.projectId,
            status: session.status,
            revision: session.revision,
            createdAt: session.createdAt,
            json: JSON.stringify(session),
        };
    }
    async get(sessionId) {
        return this.parse((await this.sessions.doc(docId(sessionId)).get()).data());
    }
    async listByProject(projectId) {
        const snap = await this.sessions.where("projectId", "==", projectId).get();
        return snap.docs
            .map((d) => this.parse(d.data()))
            .filter((s) => s !== undefined)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) ||
            a.sessionId.localeCompare(b.sessionId));
    }
    async findByIdempotencyKey(requestedBy, idempotencyKey) {
        const key = await this.keys
            .doc(docId(`${requestedBy}\u0000${idempotencyKey}`))
            .get();
        const sessionId = key.data()?.sessionId;
        return typeof sessionId === "string" ? this.get(sessionId) : undefined;
    }
    async commit(session, expectedRevision) {
        const sessionRef = this.sessions.doc(docId(session.sessionId));
        const keyRef = this.keys.doc(docId(`${session.requestedBy}\u0000${session.idempotencyKey}`));
        try {
            await this.firestore.runTransaction(async (tx) => {
                const current = await tx.get(sessionRef);
                if (expectedRevision === undefined) {
                    const key = await tx.get(keyRef);
                    if (current.exists || key.exists)
                        throw new PreconditionFailed();
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
        }
        catch (error) {
            if (error instanceof PreconditionFailed || isAlreadyExists(error))
                return "conflict";
            throw error;
        }
    }
}
export class FirestoreExecutionRecordStore {
    firestore;
    records;
    constructor(firestore, options = {}) {
        this.firestore = firestore;
        this.records = firestore.collection((options.collectionPrefix ?? "") + EXECUTION_RECORDS_COLLECTION);
    }
    doc(id, index, record) {
        return {
            recordId: id,
            projectId: index.projectId,
            kind: index.kind,
            createdAt: index.createdAt,
            ...(index.sessionId ? { sessionId: index.sessionId } : {}),
            json: JSON.stringify(record),
        };
    }
    async create(id, index, record) {
        const ref = this.records.doc(docId(id));
        try {
            await this.firestore.runTransaction(async (tx) => {
                if ((await tx.get(ref)).exists)
                    throw new PreconditionFailed();
                tx.create(ref, this.doc(id, index, record));
            });
        }
        catch (error) {
            if (error instanceof PreconditionFailed || isAlreadyExists(error))
                throw new RecordExistsError(id);
            throw error;
        }
    }
    async put(id, index, record) {
        await this.records.doc(docId(id)).set(this.doc(id, index, record));
    }
    async get(id) {
        const data = (await this.records.doc(docId(id)).get()).data();
        return typeof data?.json === "string"
            ? JSON.parse(data.json)
            : undefined;
    }
    async listBy(field, value, options) {
        const snap = await this.records.where(field, "==", value).get();
        return snap.docs
            .map((d) => d.data())
            .filter((d) => typeof d.json === "string" &&
            (!options.kind || d.kind === options.kind))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .slice(0, Math.min(Math.max(1, options.limit), MAX_RECORD_PAGE))
            .map((d) => JSON.parse(d.json));
    }
}
