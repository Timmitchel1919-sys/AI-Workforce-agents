import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import { getRun, listPreparedRequests, listRuns, runCommand } from "../api/orchestrationClient";
import { EXECUTE_CAPABILITY, POLL_INTERVAL_MS, type OrchestrationCommand, type RunView } from "../types";

const root = () => [...queryKeys.all, "executionOrchestration"] as const;
const detailKey = (id: string | undefined, token: string) => [...root(), "detail", id, token] as const;

function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

/** UX gating only; the Control Plane enforces the capability. */
export function useCanOrchestrate(): boolean {
  const { accessDetails } = useAuth();
  return Boolean(accessDetails?.capabilities?.includes(EXECUTE_CAPABILITY));
}

export function useRunList() {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "list", token],
    queryFn: () => listRuns(accessToken),
    retry: false,
    staleTime: 5_000,
  });
  return { runs: query.data ?? [], isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export function usePreparedRequests(enabled: boolean) {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "prepared", token],
    queryFn: () => listPreparedRequests(accessToken),
    enabled,
    retry: false,
    staleTime: 10_000,
  });
  return { requests: query.data ?? [], isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

/** Polls every 3 s while (and only while) the derived run status is EXECUTING. */
export function useRun(runId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery<RunView>({
    queryKey: detailKey(runId, token),
    queryFn: () => getRun(runId ?? "", accessToken),
    enabled: Boolean(runId),
    retry: false,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.status === "EXECUTING" ? POLL_INTERVAL_MS : false),
    refetchIntervalInBackground: false,
  });
  return { view: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export interface CommandInput { command: OrchestrationCommand; body: Record<string, string> }

export function useRunCommand() {
  const { accessToken } = useAuth();
  const token = useToken();
  const client = useQueryClient();
  return useMutation<RunView, unknown, CommandInput>({
    mutationFn: ({ command, body }) => runCommand(command, body, accessToken),
    onSuccess: (view) => {
      client.setQueryData(detailKey(view.run.runId, token), view);
      void client.invalidateQueries({ queryKey: [...root(), "list"] });
    },
    onError: (_error, input) => {
      // A conflict means our copy is stale: reload it.
      const runId = input.body.runId;
      if (runId) void client.invalidateQueries({ queryKey: [...root(), "detail", runId] });
    },
  });
}
