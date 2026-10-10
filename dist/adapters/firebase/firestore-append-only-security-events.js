import { validateSecurityEvent } from "../../contracts/index.js";
/**
 * Durable canonical security-event store.
 *
 * This adapter deliberately has no update or delete operation.  It uses a
 * Firestore transaction with `create`, so a duplicate event id fails instead
 * of overwriting an existing event.  Firestore Security Rules should still
 * deny client access; this boundary protects server-side composition too.
 */
export class FirestoreAppendOnlySecurityEventStore {
    firestore;
    collection;
    constructor(firestore, collectionPath = "canonical_security_events") {
        this.firestore = firestore;
        this.collection = firestore.collection(collectionPath);
    }
    async append(event) {
        validateSecurityEvent(event);
        const ref = this.collection.doc(event.eventId);
        const data = structuredClone(event);
        await this.firestore.runTransaction(async (transaction) => {
            transaction.create(ref, data);
        });
    }
    async query(query = {}) {
        const snapshot = query.projectId
            ? await this.collection.where("projectId", "==", query.projectId).get()
            : await this.collection.get();
        const events = snapshot.docs.map((document) => {
            const event = document.data();
            validateSecurityEvent(event);
            return event;
        });
        const limit = Math.min(Math.max(query.limit ?? 100, 1), 100);
        return events
            .filter((event) => !query.category || event.category === query.category)
            .filter((event) => !query.severity || event.severity === query.severity)
            .filter((event) => !query.outcome || event.outcome === query.outcome)
            .filter((event) => !query.after || event.occurredAt > query.after)
            .filter((event) => !query.before || event.occurredAt < query.before)
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            .slice(0, limit)
            .map((event) => structuredClone(event));
    }
}
