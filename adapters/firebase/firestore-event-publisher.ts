/**
 * `ControlEventPublisher` that appends control-plane events to a Firestore
 * collection (`control_events` by convention), for a future real-time client to
 * subscribe to.
 *
 * `publish` is fire-and-forget and MUST NOT throw into a command: the Firestore
 * write is dispatched without awaiting and every failure is routed to `onError`
 * (a no-op by default).
 */
import type {
  ControlEventPublisher,
  ControlPlaneEvent,
} from "../../contracts/index.js";
import type { FirestoreCollectionLike } from "./firebase-services.js";

export interface FirestoreEventPublisherOptions {
  now?: () => string;
  generateId?: () => string;
  onError?: (error: unknown) => void;
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `evt_${Date.now()}_${Math.random()}`;
}

export class FirestoreEventPublisher implements ControlEventPublisher {
  private readonly now: () => string;
  private readonly generateId: () => string;
  private readonly onError: (error: unknown) => void;

  constructor(
    private readonly collection: FirestoreCollectionLike,
    options: FirestoreEventPublisherOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.generateId = options.generateId ?? defaultId;
    this.onError = options.onError ?? (() => {});
  }

  publish(event: ControlPlaneEvent): void {
    try {
      const id = this.generateId();
      const record = {
        id,
        at: this.now(),
        ...(JSON.parse(JSON.stringify(event)) as Record<string, unknown>),
      };
      void Promise.resolve()
        .then(() => this.collection.doc(id).set(record))
        .catch((error: unknown) => this.onError(error));
    } catch (error) {
      this.onError(error);
    }
  }
}
