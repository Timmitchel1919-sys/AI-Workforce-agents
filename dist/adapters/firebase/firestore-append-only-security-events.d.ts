import type { AsyncSecurityEventStore, CanonicalSecurityEvent, SecurityEventQuery } from "../../contracts/index.js";
import type { TransactionalFirestoreLike } from "./firebase-services.js";
/**
 * Durable canonical security-event store.
 *
 * This adapter deliberately has no update or delete operation.  It uses a
 * Firestore transaction with `create`, so a duplicate event id fails instead
 * of overwriting an existing event.  Firestore Security Rules should still
 * deny client access; this boundary protects server-side composition too.
 */
export declare class FirestoreAppendOnlySecurityEventStore implements AsyncSecurityEventStore {
    private readonly firestore;
    private readonly collection;
    constructor(firestore: TransactionalFirestoreLike, collectionPath?: string);
    append(event: CanonicalSecurityEvent): Promise<void>;
    query(query?: SecurityEventQuery): Promise<CanonicalSecurityEvent[]>;
}
