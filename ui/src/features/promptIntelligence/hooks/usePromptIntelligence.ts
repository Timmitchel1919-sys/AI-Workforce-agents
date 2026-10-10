import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import {
  getPromptRequest,
  listPromptRequests,
  prepareRequest,
  requestApproval,
  type PrepareInput,
} from "../api/promptClient";
import type { PromptRequestView } from "../types";

const root = () => [...queryKeys.all, "promptIntelligence"] as const;
const detailKey = (id: string | undefined, token: string) => [...root(), "detail", id, token] as const;

function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

export function usePromptHistory() {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: [...root(), "list", token],
    queryFn: () => listPromptRequests(accessToken),
    retry: false,
    staleTime: 10_000,
  });
  return { requests: query.data ?? [], isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export function usePromptRequest(requestId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  const query = useQuery({
    queryKey: detailKey(requestId, token),
    queryFn: () => getPromptRequest(requestId ?? "", accessToken),
    enabled: Boolean(requestId),
    retry: false,
    staleTime: 10_000,
  });
  return { view: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export function usePrepareRequest() {
  const { accessToken } = useAuth();
  const token = useToken();
  const client = useQueryClient();
  return useMutation<PromptRequestView, unknown, PrepareInput>({
    mutationFn: (input) => prepareRequest(input, accessToken),
    onSuccess: (view) => {
      client.setQueryData(detailKey(view.record.requestId, token), view);
      void client.invalidateQueries({ queryKey: [...root(), "list"] });
    },
  });
}

export function useRequestApproval() {
  const { accessToken } = useAuth();
  const token = useToken();
  const client = useQueryClient();
  return useMutation<PromptRequestView, unknown, string>({
    mutationFn: (requestId) => requestApproval(requestId, accessToken),
    onSuccess: (view) => {
      client.setQueryData(detailKey(view.record.requestId, token), view);
      void client.invalidateQueries({ queryKey: [...root(), "list"] });
    },
    onError: (_error, requestId) => {
      // A conflict means our copy is stale: reload it.
      void client.invalidateQueries({ queryKey: [...root(), "detail", requestId] });
    },
  });
}
