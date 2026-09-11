import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { agentsApi, invalidateForCommand } from "../../api";

type AgentInput = Parameters<typeof agentsApi.disableAgent>[1];

export function useDisableAgent() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentInput) => agentsApi.disableAgent(client, input),
    onSuccess: (_result, input) =>
      invalidateForCommand(qc, "disable-agent", { agentId: input.agentId }),
  });
}

export function useEnableAgent() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentInput) => agentsApi.enableAgent(client, input),
    onSuccess: (_result, input) =>
      invalidateForCommand(qc, "enable-agent", { agentId: input.agentId }),
  });
}
