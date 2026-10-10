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
export * from "./production-workforce-bootstrap.js";
export * from "./production-workforce-config.js";
export * from "./production-control-plane.js";
export * from "./bootstrap-initial-admin.js";
export * from "../adapters/models/openai-model-provider.js";
export * from "../agents/control-plane-analysis/index.js";
