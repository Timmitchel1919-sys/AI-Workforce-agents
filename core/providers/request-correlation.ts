import type { ModelRequest } from "../../contracts/index.js";

/**
 * Correlation ids a model-provider decorator can read from
 * `request.metadata`, when the caller supplied them. Never invented.
 */
export function extractCorrelation(request: ModelRequest): {
  taskId?: string;
  agentId?: string;
  projectId?: string;
} {
  const meta = request.metadata ?? {};
  const out: { taskId?: string; agentId?: string; projectId?: string } = {};
  if (typeof meta.taskId === "string") out.taskId = meta.taskId;
  if (typeof meta.agentId === "string") out.agentId = meta.agentId;
  if (typeof meta.projectId === "string") out.projectId = meta.projectId;
  return out;
}

/**
 * A caller-supplied idempotency key from `request.metadata`, read separately
 * from `extractCorrelation` so that helper's return shape — and every
 * existing caller relying on it — is untouched. `undefined` when the caller
 * gave none: no key means no dedupe is possible, which is reported honestly
 * by whatever records usage, never assumed safe.
 */
export function extractIdempotencyKey(
  request: ModelRequest,
): string | undefined {
  const key = request.metadata?.idempotencyKey;
  return typeof key === "string" && key.trim() ? key : undefined;
}
