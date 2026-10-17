export const ASSIGNMENTS_COLLECTION = "assignments";
export class FirestoreAssignmentRepository {
    collection;
    items = new Map();
    pending = new Set();
    onError;
    ready;
    constructor(firestore, options = {}) {
        this.collection = firestore.collection((options.collectionPrefix ?? "") + ASSIGNMENTS_COLLECTION);
        this.onError =
            options.onError ??
                ((error, { assignmentId }) => {
                    console.error(`[FirestoreAssignmentRepository] background write failed for ${assignmentId}:`, error);
                });
        this.ready = this.load();
    }
    async load() {
        const snapshot = await this.collection.get();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (data && typeof data.assignmentId === "string") {
                this.items.set(data.assignmentId, data);
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
        this.items.set(item.assignmentId, item);
        this.enqueueWrite(item);
    }
    currentForTask(taskId) {
        return this.list()
            .filter((a) => a.taskId === taskId && a.status !== "reassigned")
            .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt) ||
            a.assignmentId.localeCompare(b.assignmentId))[0];
    }
    historyForTask(taskId) {
        return this.list()
            .filter((a) => a.taskId === taskId)
            .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
    }
    /** Await every outstanding background write; call at response boundaries. */
    async flush() {
        while (this.pending.size > 0) {
            await Promise.allSettled([...this.pending]);
        }
    }
    enqueueWrite(item) {
        const payload = JSON.parse(JSON.stringify(item));
        const promise = this.collection
            .doc(item.assignmentId)
            .set(payload)
            .catch((error) => {
            this.onError(error, { assignmentId: item.assignmentId });
        })
            .finally(() => {
            this.pending.delete(promise);
        });
        this.pending.add(promise);
    }
}
