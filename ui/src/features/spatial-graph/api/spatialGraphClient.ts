import { apiRequest } from "../../../api/client";
import type { WorkforceGraphProjection } from "../../../../../contracts/graph";

export async function fetchWorkforceGraph(projectId: string, depth?: number): Promise<WorkforceGraphProjection> {
  const url = new URLSearchParams();
  if (depth !== undefined) {
    url.append("depth", depth.toString());
  }
  return apiRequest<WorkforceGraphProjection>(`/projects/${projectId}/graph?${url.toString()}`);
}
