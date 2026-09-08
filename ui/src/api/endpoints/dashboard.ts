import type { ApiClient } from "../client";
import type { DashboardSnapshot, WorkforceStatus } from "../contracts";

/** `GET /api/status` — headline counts + overall health. */
export function getStatus(client: ApiClient) {
  return client.get<WorkforceStatus>("/status").then((r) => r.data);
}

/** `GET /api/dashboard` — the full bounded snapshot the overview renders from. */
export function getDashboard(client: ApiClient) {
  return client.get<DashboardSnapshot>("/dashboard").then((r) => r.data);
}
