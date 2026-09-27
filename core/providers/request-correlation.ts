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
