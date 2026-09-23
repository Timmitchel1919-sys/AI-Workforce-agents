import { firestoreRepository, } from "../adapters/firebase/index.js";
import { CachedRepository, } from "../core/index.js";
export class FirebaseRepositoryProvider {
    firestore;
    repos = new Map();
    prefix;
    onError;
    constructor(firestore, options = {}) {
        this.firestore = firestore;
        this.prefix = options.collectionPrefix ?? "";
        this.onError = options.onWriteError;
    }
    /** A cached repository for a Firestore collection. Same instance per path. */
    repository(collectionPath) {
        const cached = this.repos.get(collectionPath);
        if (cached)
            return cached;
        const async = firestoreRepository(this.firestore, this.prefix + collectionPath);
        const created = new CachedRepository(async, this.onError ? { onError: this.onError } : {});
        this.repos.set(collectionPath, created);
        return created;
    }
    /** Hydrate every repository created so far. Await before serving traffic. */
    async hydrateAll() {
        for (const [collection, repo] of this.repos) {
            try {
                await repo.hydrate();
            }
            catch (cause) {
                // Preserve a machine-readable provider code while ensuring callers do
                // not log the provider's original error text or request details.
                const candidateCode = cause && typeof cause === "object" && "code" in cause
                    ? cause.code
                    : undefined;
                const error = new Error("Control Plane repository hydration failed");
                Object.assign(error, {
                    safePhase: "firestore_hydration",
                    collection,
                    ...(typeof candidateCode === "string" ||
                        typeof candidateCode === "number"
                        ? { code: candidateCode }
                        : {}),
                });
                throw error;
            }
        }
    }
    /** Await every pending background write. Call on graceful shutdown. */
    async flushAll() {
        for (const repo of this.repos.values())
            await repo.flush();
    }
    get pendingWrites() {
        let total = 0;
        for (const repo of this.repos.values())
            total += repo.pendingWrites;
        return total;
    }
}
