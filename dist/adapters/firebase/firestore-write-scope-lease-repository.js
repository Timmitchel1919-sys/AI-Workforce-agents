export const WRITE_SCOPE_LEASES_COLLECTION = "write_scope_leases";
export class FirestoreWriteScopeLeaseRepository {
    collection;
    items = new Map();
    pending = new Set();
    onError;
    ready;
    constructor(firestore, options = {}) {
        this.collection = firestore.collection((options.collectionPrefix ?? "") + WRITE_SCOPE_LEASES_COLLECTION);
        this.onError =
            options.onError ??
                ((error, { leaseId }) => {
                    console.error(`[FirestoreWriteScopeLeaseRepository] background write failed for ${leaseId}:`, error);
                });
        this.ready = this.load();
    }
    async load() {
        const snapshot = await this.collection.get();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (data && typeof data.leaseId === "string") {
                this.items.set(data.leaseId, data);
            }
        }
    }
    list() {
        return [...this.items.values()];
    }
    findById(id) {
        return this.items.get(id);
    }
    upsert(item) {
        this.items.set(item.leaseId, item);
        this.enqueueWrite(item);
    }
    async flush() {
        while (this.pending.size > 0) {
            await Promise.allSettled([...this.pending]);
        }
    }
    enqueueWrite(item) {
        const payload = JSON.parse(JSON.stringify(item));
        const promise = this.collection
            .doc(item.leaseId)
            .set(payload)
            .catch((error) => {
            this.onError(error, { leaseId: item.leaseId });
        })
            .finally(() => {
            this.pending.delete(promise);
        });
        this.pending.add(promise);
    }
}
