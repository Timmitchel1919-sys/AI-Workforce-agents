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

export type FirebaseCompatibleRequest = IncomingMessage & { body?: unknown };
export type FirebaseCompatibleResponse = ServerResponse;

export interface RuntimeSingleton {
  get(): Promise<ControlPlaneHttpRuntime>;
}

/**
 * Memoizes both the successful runtime and an in-flight initialization.
 * A failed cold start remains failed for that container; a new function
 * instance gets a clean initialization attempt instead of a fake fallback.
 */
export function createRuntimeSingleton(
  factory: ControlPlaneRuntimeFactory,
): RuntimeSingleton {
  let runtime: Promise<ControlPlaneHttpRuntime> | undefined;

  return Object.freeze({
    get(): Promise<ControlPlaneHttpRuntime> {
      runtime ??= factory();
      return runtime;
    },
  });
}

/**
 * Creates an async Firebase HTTPS request handler around a Control Plane
 * runtime factory. Express request/response objects used by `onRequest` are
 * Node-compatible, so no route, method, header, or body transformation occurs
 * here.
 */
export function createControlPlaneHttpsAdapter(
  factory: ControlPlaneRuntimeFactory,
): (
  request: FirebaseCompatibleRequest,
  response: FirebaseCompatibleResponse,
) => Promise<void> {
  const singleton = createRuntimeSingleton(factory);

  return async (request, response): Promise<void> => {
    try {
      const runtime = await singleton.get();
      runtime.handler(request, response);
    } catch (error) {
      logInitializationFailure(error);
      sendUnavailable(response);
    }
  };
}

function logInitializationFailure(error: unknown): void {
  // Error messages may carry provider or platform details. Log only the
  // category so Cloud Logging is useful without risking credential disclosure.
  const errorType = error instanceof Error ? error.name : "unknown";
  console.error("Control Plane runtime initialization failed", { errorType });
}

function sendUnavailable(response: ServerResponse): void {
  if (response.headersSent || response.writableEnded) return;
  const payload = JSON.stringify({
    error: { message: "control plane unavailable" },
  });
  response.writeHead(500, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
