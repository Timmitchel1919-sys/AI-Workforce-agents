/**
 * EO-4.8 durable ledger for release records (reviews, stage sets, commit and
 * push receipts, pull requests, deployment candidates, releases).
 *
 * - Every record is written to the ExecutionRecordStore (awaited) and cached
 *   in memory; lookups fall back to the store, so records survive restarts
 *   and are visible across Control Plane instances.
 * - Idempotency is a create-only RESERVATION taken before the protected
 *   mutation (commit / push / deploy): two instances handling the same key
 *   can never both mutate; a finished key replays its original result.
 * - Uniqueness markers (e.g. one commit per stage set) are create-only too.
 * Without a store the ledger behaves identically in memory (tests, local).
 */
import { RecordExistsError, StateTransitionError, requireExecutionId, } from "../../contracts/index.js";
/** An in-progress reservation older than this is considered abandoned. */
const STALE_RESERVATION_MS = 10 * 60_000;
export class DurableLedger {
    store;
    clock;
    caches = new Map();
    reservations = new Map();
    constructor(store, clock) {
        this.store = store;
        this.clock = clock;
    }
    cache(kind) {
        let map = this.caches.get(kind);
        if (!map) {
            map = new Map();
            this.caches.set(kind, map);
        }
        return map;
    }
    /** Persist (awaited) then cache. `create` = immutable evidence. */
    async save(kind, id, projectId, createdAt, record, mode = "create") {
        const index = { projectId, kind, createdAt };
        if (this.store) {
            if (mode === "create")
                await this.store.create(`${kind}:${id}`, index, record);
            else
                await this.store.put(`${kind}:${id}`, index, record);
        }
        this.cache(kind).set(id, record);
        return record;
    }
    async find(kind, id) {
        const cached = this.cache(kind).get(id);
        if (cached !== undefined)
            return cached;
        const stored = await this.store?.get(`${kind}:${id}`);
        if (stored !== undefined)
            this.cache(kind).set(id, Object.freeze(stored));
        return stored;
    }
    /** Live + durable records of one project, newest first, bounded. */
    async list(kind, projectId, limit, idOf, dateOf = (r) => r.createdAt) {
        const live = [...this.cache(kind).values()].filter((r) => r.projectId === projectId);
        const stored = this.store
            ? await this.store.listBy("projectId", projectId, { kind, limit })
            : [];
        const seen = new Set(live.map(idOf));
        return [...live, ...stored.filter((r) => !seen.has(idOf(r)))]
            .sort((a, b) => dateOf(b).localeCompare(dateOf(a)))
            .slice(0, Math.min(Math.max(1, limit), 200));
    }
    reservationId(scope, actor, key) {
        return `idem:${scope}:${actor}\u0000${requireExecutionId(key, "idempotencyKey")}`;
    }
    /**
     * Take the idempotency reservation for `(scope, actor, key)`. Returns the
     * result id of a finished request (replay), or undefined when the caller
     * now owns the reservation. Throws when another request holds it.
     */
    async claim(scope, actor, key, projectId) {
        const id = this.reservationId(scope, actor, key);
        const at = this.clock();
        const busy = () => new StateTransitionError("an identical request is already in progress");
        const fresh = (r) => Date.parse(r.at) > Date.parse(at) - STALE_RESERVATION_MS;
        const local = this.reservations.get(id);
        if (local?.state === "done")
            return local.resultId;
        if (local?.state === "in_progress" && fresh(local))
            throw busy();
        const existing = this.store ? await this.store.get(id) : local;
        if (existing?.state === "done") {
            this.reservations.set(id, existing);
            return existing.resultId;
        }
        if (existing?.state === "in_progress" && fresh(existing))
            throw busy();
        const reservation = { state: "in_progress", at };
        if (this.store) {
            const index = { projectId, kind: "idempotency", createdAt: at };
            if (existing) {
                await this.store.put(id, index, reservation);
            }
            else {
                try {
                    await this.store.create(id, index, reservation);
                }
                catch (error) {
                    if (error instanceof RecordExistsError)
                        throw busy();
                    throw error;
                }
            }
        }
        this.reservations.set(id, reservation);
        return undefined;
    }
    /** Finish a reservation: `resultId` = done (replayable), none = failed (retryable). */
    async settle(scope, actor, key, projectId, resultId) {
        const id = this.reservationId(scope, actor, key);
        const reservation = resultId
            ? { state: "done", resultId, at: this.clock() }
            : { state: "failed", at: this.clock() };
        this.reservations.set(id, reservation);
        await this.store?.put(id, { projectId, kind: "idempotency", createdAt: reservation.at }, reservation);
    }
    /** Create-only uniqueness marker (e.g. one commit per stage set). */
    async reserveUnique(kind, id, projectId, message) {
        const cache = this.cache(`unique:${kind}`);
        if (cache.get(id))
            throw new StateTransitionError(message);
        if (this.store) {
            try {
                await this.store.create(`unique:${kind}:${id}`, { projectId, kind: `unique:${kind}`, createdAt: this.clock() }, { id });
            }
            catch (error) {
                if (error instanceof RecordExistsError)
                    throw new StateTransitionError(message);
                throw error;
            }
        }
        cache.set(id, true);
    }
}
