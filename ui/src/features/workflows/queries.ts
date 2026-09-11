import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { workflowsApi, queryKeys, parseResponse } from "../../api";

export function useWorkflows() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.workflows.list(),
    queryFn: () =>
      workflowsApi.listWorkflows(client).then(parseResponse.workflowList),
  });
}

export function useWorkflow(workflowId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.workflows.detail(workflowId ?? ""),
    queryFn: () =>
      workflowsApi
        .getWorkflow(client, workflowId as string)
        .then(parseResponse.workflow),
    enabled: Boolean(workflowId),
  });
}
