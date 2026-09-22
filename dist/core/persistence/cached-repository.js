import { WorkforceError } from "../../contracts/index.js";
import { InMemoryRepository } from "./in-memory-repository.js";
export class CachedRepository {
    backing;
    cache = new InMemoryRepository();
    onError;
    hydrated = false;
    queue = Promise.resolve();
    pending = 0;
    constructor(backing, options = {}) {
        this.backing = backing;
        this.onError = options.onError ?? (() => { });
    }
    /** Load the full backing collection into memory. Await before first use. */
    async hydrate() {
        const all = await this.backing.list();
        this.cache.clear();
        for (const entity of all)
            this.cache.upsert(entity);
        this.hydrated = true;
        return this;
    }
    /** Number of backing-store writes not yet acknowledged. */
    get pendingWrites() {
        return this.pending;
    }
    /** Resolve once every queued backing-store write has settled. */
    async flush() {
        await this.queue;
    }
    upsert(entity) {
        this.assertHydrated();
        this.cache.upsert(entity);
        const snapshot = structuredClone(entity);
        this.enqueue("upsert", () => this.backing.upsert(snapshot));
    }
    findById(id) {
        this.assertHydrated();
        return this.cache.findById(id);
    }
    list() {
        this.assertHydrated();
        return this.cache.list();
    }
    delete(id) {
        this.assertHydrated();
        const existed = this.cache.delete(id);
        this.enqueue("delete", () => this.backing.delete(id));
        return existed;
    }
    clear() {
        this.assertHydrated();
        this.cache.clear();
        this.enqueue("clear", () => this.backing.clear());
    }
    assertHydrated() {
        if (!this.hydrated) {
            throw new WorkforceError("CachedRepository used before hydrate() completed");
        }
    }
    enqueue(operation, run) {
        this.pending += 1;
        this.queue = this.queue
            .then(async () => {
            await run();
        })
            .catch((error) => {
            this.onError(operation, error);
        })
            .finally(() => {
            this.pending -= 1;
        });
    }
}
