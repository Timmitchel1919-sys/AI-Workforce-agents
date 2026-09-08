/**
 * Workforce Control & Operations Layer — public entry point.
 *
 * Layering:  UI → control services → core → contracts.
 * The Control Plane never talks to a database, a filesystem, a shell, or a
 * credential; it reads through core services and acts through them.
 */
export * from "./context.js";
export * from "./ports.js";
export * from "./errors.js";
export * from "./correlation.js";
export * from "./stores.js";
export * from "./redaction.js";
export * from "./risk.js";
export * from "./health.js";
export * from "./derive.js";
export * from "./services/workforce-query-service.js";
export * from "./services/workforce-command-service.js";
export * from "./dashboard/render.js";
export * from "./dashboard/build-html.js";
