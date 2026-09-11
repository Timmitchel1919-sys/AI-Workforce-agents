import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { toolsApi, queryKeys, parseResponse } from "../../api";

export function useTools() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.tools.list(),
    queryFn: () => toolsApi.listTools(client).then(parseResponse.toolList),
  });
}

export function useTool(toolId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.tools.detail(toolId ?? ""),
    queryFn: () =>
      toolsApi.getTool(client, toolId as string).then(parseResponse.tool),
    enabled: Boolean(toolId),
  });
}
