import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import {
  getCandidates, getConflicts, getContext, getDecisions, getDocuments, getGraph, getMemory, getOverview,
  listMemories, runKnowledgeCommand, searchMemories,
} from "../api/knowledgeClient";
import { MANAGE_CAPABILITY, type CommandInput, type CommandResult, type ContextRole, type MemoryFilters } from "../types";

const root = () => [...queryKeys.all, "knowledge"] as const;

function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

/** UX gating only; the Control Plane enforces the capability. */
export function useCanManage(): boolean {
  const { accessDetails } = useAuth();
  return Boolean(accessDetails?.capabilities?.includes(MANAGE_CAPABILITY));
}

export function useIsAdmin(): boolean {
  return useAuth().accessDetails?.role === "admin";
}

const opts = { retry: false, staleTime: 5_000 } as const;

export function useOverview(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "overview", projectId ?? "all", token], queryFn: () => getOverview(projectId, accessToken), ...opts });
}

export function useCandidates(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "candidates", projectId ?? "all", token], queryFn: () => getCandidates(projectId, accessToken), ...opts });
}

/** Listing (empty query) and ranked search (non-empty query) share one result shape for the UI. */
export function useMemories(projectId: string | undefined, filters: MemoryFilters) {
  const { accessToken } = useAuth();
  const token = useToken();
  const searching = filters.q.trim().length > 0;
  return useQuery({
    queryKey: [...root(), "memories", projectId ?? "all", filters, token],
    queryFn: async () => {
      if (searching) {
        const hits = await searchMemories(projectId, filters, accessToken);
        return { mode: "search" as const, hits, memories: hits, total: hits.length };
      }
      const list = await listMemories(projectId, filters, accessToken);
      return { mode: "list" as const, hits: [], memories: list.memories, total: list.total };
    },
    ...opts,
  });
}

export function useMemory(memoryId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "memory", memoryId, token],
    queryFn: () => getMemory(memoryId ?? "", accessToken),
    enabled: Boolean(memoryId),
    retry: false,
    staleTime: 0,
  });
}

export function useGraph(projectId: string | undefined, types: readonly string[]) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "graph", projectId, [...types].sort().join(","), token],
    queryFn: () => getGraph(projectId ?? "", types, accessToken),
    enabled: Boolean(projectId),
    ...opts,
  });
}

export function useConflicts(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "conflicts", projectId ?? "all", token], queryFn: () => getConflicts(projectId, accessToken), ...opts });
}

export function useDocuments(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "documents", projectId ?? "all", token], queryFn: () => getDocuments(projectId, accessToken), ...opts });
}

export function useDecisions(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({ queryKey: [...root(), "decisions", projectId ?? "all", token], queryFn: () => getDecisions(projectId, accessToken), ...opts });
}

/** Runs only after the operator submits the form (`request` is null until then). */
export function useContextPreview(request: { projectId: string; q: string; role: ContextRole } | null) {
  const { accessToken } = useAuth();
  const token = useToken();
  return useQuery({
    queryKey: [...root(), "context", request, token],
    queryFn: () => getContext(request?.projectId ?? "", request?.q ?? "", request?.role ?? "developer", accessToken),
    enabled: request !== null,
    retry: false,
    staleTime: 0,
  });
}

/** Every successful or failed command refetches all knowledge queries so the screen reflects the server. */
export function useKnowledgeCommand() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation<CommandResult, unknown, CommandInput>({
    mutationFn: ({ command, body }) => runKnowledgeCommand(command, body, accessToken),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: root() });
    },
  });
}
