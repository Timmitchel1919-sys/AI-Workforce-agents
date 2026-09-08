import type { ApiClient } from "../client";
import type { ProjectView } from "../contracts";

export function listProjects(client: ApiClient) {
  return client.get<ProjectView[]>("/projects").then((r) => r.data);
}

export function getProject(client: ApiClient, projectId: string) {
  return client
    .get<ProjectView>(`/projects/${encodeURIComponent(projectId)}`)
    .then((r) => r.data);
}
