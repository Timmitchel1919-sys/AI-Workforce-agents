import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/useAuth";
import {
  KnowledgeError,
  createKnowledge,
  getKnowledgeItem,
  getKnowledgeItems,
  updateKnowledge,
  type CreateKnowledgeInput,
  type KnowledgeFailure,
  type KnowledgeFilter,
  type UpdateKnowledgeInput,
} from "./knowledgeClient";

const KNOWLEDGE_KEY = ["workforce", "knowledge"] as const;

export type KnowledgeListState =
  "loading" | "ready" | "empty" | KnowledgeFailure;
export type KnowledgeDetailState =
  "loading" | "ready" | "not_found" | KnowledgeFailure;

function failureOf(error: unknown): KnowledgeFailure {
  return error instanceof KnowledgeError ? error.failure : "unavailable";
}

export function useKnowledgeItems(filter: KnowledgeFilter) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...KNOWLEDGE_KEY, filter, accessToken ?? "anonymous"],
    queryFn: () => getKnowledgeItems(filter, accessToken),
    retry: false,
    staleTime: 15_000,
  });
  const items = query.data?.items ?? [];
  const state: KnowledgeListState = query.isLoading
    ? "loading"
    : query.error
      ? failureOf(query.error)
      : items.length === 0
        ? "empty"
        : "ready";
  return {
    state,
    items,
    total: query.data?.total ?? 0,
    refetch: () => void query.refetch(),
  };
}

export function useKnowledgeItem(knowledgeId?: string) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [
      ...KNOWLEDGE_KEY,
      "detail",
      knowledgeId,
      accessToken ?? "anonymous",
    ],
    queryFn: () => getKnowledgeItem(knowledgeId as string, accessToken),
    enabled: Boolean(knowledgeId),
    retry: false,
    staleTime: 15_000,
  });
  const state: KnowledgeDetailState = !knowledgeId
    ? "not_found"
    : query.isLoading && !query.data
      ? "loading"
      : query.error
        ? failureOf(query.error)
        : query.data
          ? "ready"
          : "not_found";
  return {
    state,
    item: query.data,
    refetch: () => void query.refetch(),
  };
}

function useInvalidate() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: KNOWLEDGE_KEY });
  };
}

export function useCreateKnowledge() {
  const { accessToken } = useAuth();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateKnowledgeInput) =>
      createKnowledge(input, accessToken),
    onSettled: invalidate,
  });
}

export function useUpdateKnowledge() {
  const { accessToken } = useAuth();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateKnowledgeInput }) =>
      updateKnowledge(id, input, accessToken),
    onSettled: invalidate,
  });
}
