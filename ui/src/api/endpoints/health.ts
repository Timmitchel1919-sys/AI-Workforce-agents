import type { ApiClient } from "../client";
import type { SystemHealth } from "../contracts";

export interface LivenessResponse {
  status: string;
}

/** `GET /api/health` — liveness, no auth. */
export function getLiveness(client: ApiClient) {
  return client.get<LivenessResponse>("/health").then((r) => r.data);
}

/** `GET /api/system-health` — measured component health. */
export function getSystemHealth(client: ApiClient) {
  return client.get<SystemHealth>("/system-health").then((r) => r.data);
}
