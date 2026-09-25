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
  /** Await pending durable writes (EO-4.8: flushed before a response ends). */
  flush?(): Promise<void>;
}

/** Upper bound for flushing writes before a response is released. */
export const FLUSH_BEFORE_RESPONSE_MS = 5_000;

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
      if (runtime.flush) holdResponseUntilFlushed(response, runtime.flush);
      await Promise.resolve(runtime.handler(request, response));
    } catch (error) {
      logInitializationFailure(error);
      sendUnavailable(response);
    }
  };
}

/**
 * EO-4.8: the response is only released after pending Firestore writes
 * (audit, approvals, …) are flushed, bounded by FLUSH_BEFORE_RESPONSE_MS.
 * A serverless instance may freeze right after the response; nothing that
 * the response already reported may still be in flight at that moment.
 */
export function holdResponseUntilFlushed(
  response: ServerResponse,
  flush: () => Promise<void>,
  timeoutMs = FLUSH_BEFORE_RESPONSE_MS,
): void {
  const end = response.end.bind(response) as (
    ...args: unknown[]
  ) => ServerResponse;
  let ending = false;
  (response as unknown as { end: (...args: unknown[]) => ServerResponse }).end =
    (...args: unknown[]) => {
      if (ending) return response;
      ending = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      void Promise.race([
        flush(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ])
        .catch(() => {
          console.error("Control Plane durable flush failed", {
            phase: "flush_before_response",
          });
        })
        .finally(() => {
          clearTimeout(timer);
          end(...args);
        });
      return response;
    };
}

function logInitializationFailure(error: unknown): void {
  // Error messages may carry provider or platform details. Log only the
  // category and a safe platform error code without risking credential
  // disclosure.
  const errorType = error instanceof Error ? error.name : "unknown";
  const candidateCode =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  const errorCode =
    typeof candidateCode === "number" || typeof candidateCode === "string"
      ? candidateCode
      : undefined;
  const safePhase =
    error && typeof error === "object" && "safePhase" in error
      ? (error as { safePhase?: unknown }).safePhase
      : undefined;
  const collection =
    error && typeof error === "object" && "collection" in error
      ? (error as { collection?: unknown }).collection
      : undefined;
  console.error("Control Plane runtime initialization failed", {
    errorType,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(typeof safePhase === "string" ? { safePhase } : {}),
    ...(typeof collection === "string" ? { collection } : {}),
  });
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
