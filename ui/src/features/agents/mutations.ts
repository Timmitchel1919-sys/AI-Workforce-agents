import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { agentsApi, invalidateForCommand } from "../../api";
import type { ControlCommandResult } from "../../api/contracts";

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

/**
 * The complete set of Agent lifecycle commands the Control Plane exposes
 * today (`CONTROL_COMMANDS` in contracts/control.ts, filtered to the two
 * that end in `_agent`). There is no activate / pause / resume / restart /
 * configure / delete command for agents on the backend — this union is
 * deliberately not larger than that.
 */
export type AgentAction = "disable" | "enable";
export type AgentActionStatus = "idle" | "pending" | "success" | "error";

/**
 * Uniform mutation surface over the two agent commands, so the UI submits
 * through one shape regardless of which action was chosen:
 *
 *   AgentActions (UI)  →  useAgentActions()  →  agentsApi.*  →  ApiClient  →  Control Plane
 *
 * Never Firestore, never a second API. No optimistic state — `status`
 * reflects only the server-confirmed mutation state; a success invalidates
 * the agent queries so the next render shows Control-Plane-authoritative
 * data (see `invalidateForCommand`).
 */
export function useAgentActions() {
  const disable = useDisableAgent();
  const enable = useEnableAgent();
  const [lastAction, setLastAction] = useState<AgentAction | null>(null);

  const active =
    lastAction === "disable"
      ? disable
      : lastAction === "enable"
        ? enable
        : null;

  const status: AgentActionStatus = useMemo(() => {
    if (!active) return "idle";
    if (active.isPending) return "pending";
    if (active.isSuccess) return "success";
    if (active.isError) return "error";
    return "idle";
  }, [active]);

  async function execute(
    action: AgentAction,
    input: AgentInput,
  ): Promise<ControlCommandResult> {
    setLastAction(action);
    const mutation = action === "disable" ? disable : enable;
    return mutation.mutateAsync(input);
  }

  function reset() {
    disable.reset();
    enable.reset();
    setLastAction(null);
  }

  return { execute, status, error: active?.error ?? null, reset };
}
