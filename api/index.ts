/**
 * Control Plane API layer — the composition root.
 *
 * Wraps `WorkforceQueryService` / `WorkforceCommandService` in an HTTP surface
 * and wires the Firebase infrastructure adapters in. Sits above `control/`,
 * `core/`, and `adapters/`:
 *
 *   UI → api → control → core → contracts
 *              └→ adapters/firebase (persistence, auth, events)
 */
export * from "./http-api.js";
export * from "./firebase-repositories.js";
