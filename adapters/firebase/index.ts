/**
 * Firebase infrastructure adapters.
 *
 * Every adapter here implements a provider-neutral contract port
 * (`AsyncRepository`, `OperatorDirectory`, `ControlEventPublisher`,
 * `ObjectStore`) and depends only on `contracts/` plus a narrow seam over
 * `firebase-admin` (an optional peer dependency, loaded lazily). Nothing in
 * `core/` or `control/` imports this module — it is wired in at the composition
 * root (`api/`). See ADR-0011.
 */
export * from "./firebase-services.js";
export * from "./firestore-repository.js";
export * from "./firebase-operator-directory.js";
export * from "./firestore-event-publisher.js";
export * from "./firebase-object-store.js";
