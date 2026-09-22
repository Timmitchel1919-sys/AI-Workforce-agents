/**
 * `ControlEventPublisher` that appends control-plane events to a Firestore
 * collection (`control_events` by convention), for a future real-time client to
 * subscribe to.
 *
 * `publish` is fire-and-forget and MUST NOT throw into a command: the Firestore
 * write is dispatched without awaiting and every failure is routed to `onError`
 * (a no-op by default).
 */
import type { ControlEventPublisher, ControlPlaneEvent } from "../../contracts/index.js";
import type { FirestoreCollectionLike } from "./firebase-services.js";
export interface FirestoreEventPublisherOptions {
    now?: () => string;
    generateId?: () => string;
    onError?: (error: unknown) => void;
}
export declare class FirestoreEventPublisher implements ControlEventPublisher {
    private readonly collection;
    private readonly now;
    private readonly generateId;
    private readonly onError;
    constructor(collection: FirestoreCollectionLike, options?: FirestoreEventPublisherOptions);
    publish(event: ControlPlaneEvent): void;
}
