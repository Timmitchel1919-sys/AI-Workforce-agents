/**
 * Thin Node-to-Firebase HTTPS adapter.
 *
 * The authoritative Control Plane composition lives in
 * `api/production-control-plane.ts`. This module deliberately knows only how
 * to initialize that runtime once and forward compatible request/response
 * objects to its HTTP handler.
 */
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type ApiHandler } from "../api/http-api.js";
export interface ControlPlaneHttpRuntime {
    readonly handler: ApiHandler;
}
export type ControlPlaneRuntimeFactory = () => Promise<ControlPlaneHttpRuntime>;
export type FirebaseCompatibleRequest = IncomingMessage & {
    body?: unknown;
};
export type FirebaseCompatibleResponse = ServerResponse;
export interface RuntimeSingleton {
    get(): Promise<ControlPlaneHttpRuntime>;
}
/**
 * Memoizes both the successful runtime and an in-flight initialization.
 * A failed cold start remains failed for that container; a new function
 * instance gets a clean initialization attempt instead of a fake fallback.
 */
export declare function createRuntimeSingleton(factory: ControlPlaneRuntimeFactory): RuntimeSingleton;
/**
 * Creates an async Firebase HTTPS request handler around a Control Plane
 * runtime factory. Express request/response objects used by `onRequest` are
 * Node-compatible, so no route, method, header, or body transformation occurs
 * here.
 */
export declare function createControlPlaneHttpsAdapter(factory: ControlPlaneRuntimeFactory): (request: FirebaseCompatibleRequest, response: FirebaseCompatibleResponse) => Promise<void>;
