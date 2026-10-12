/**
 * Security Foundation V1 — Layer 5: API Security Middleware.
 *
 * Request-boundary primitives the Control Plane HTTP handler composes
 * BEFORE identity / capability / project / policy checks. These are
 * narrow, defense-in-depth building blocks — never a replacement for
 * capability authorization. Order enforced by `createControlPlaneApi`:
 *
 *   transport → correlation → method → content-type → body-size →
 *   CORS → rate-limit → App Check → auth → operator → capability →
 *   project → validation → governance → security policy →
 *   MFA/reauth → destructive gate → executor → audit → canonical event
 *
 * The policy / destructive services (Layers 2 and 3) still enforce
 * their own invariants; this layer only ensures those services run
 * with trustworthy, bounded request context.
 */
export * from "./app-check.js";
export * from "./rate-limit.js";
export * from "./headers.js";
export * from "./cors.js";
export * from "./errors.js";
export * from "./context.js";
export * from "./approver-resolver.js";
export * from "./destructive-event-adapter.js";
