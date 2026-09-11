import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { agentsApi, queryKeys, parseResponse } from "../../api";

export function useAgents() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.agents.list(),
    queryFn: () => agentsApi.listAgents(client).then(parseResponse.agentList),
  });
}

export function useAgent(agentId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.agents.detail(agentId ?? ""),
    queryFn: () =>
      agentsApi.getAgent(client, agentId as string).then(parseResponse.agent),
    enabled: Boolean(agentId),
  });
}
