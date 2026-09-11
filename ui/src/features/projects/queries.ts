import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { projectsApi, queryKeys, parseResponse } from "../../api";

export function useProjects() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: () =>
      projectsApi.listProjects(client).then(parseResponse.projectList),
  });
}

export function useProject(projectId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ""),
    queryFn: () =>
      projectsApi
        .getProject(client, projectId as string)
        .then(parseResponse.project),
    enabled: Boolean(projectId),
  });
}
