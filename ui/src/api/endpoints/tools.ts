import type { ApiClient } from "../client";
import type { ToolView } from "../contracts";

export function listTools(client: ApiClient) {
  return client.get<ToolView[]>("/tools").then((r) => r.data);
}

export function getTool(client: ApiClient, toolId: string) {
  return client
    .get<ToolView>(`/tools/${encodeURIComponent(toolId)}`)
    .then((r) => r.data);
}
