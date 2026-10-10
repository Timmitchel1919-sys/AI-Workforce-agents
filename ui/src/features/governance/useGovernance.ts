import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/useAuth";
import {
  GovernanceError,
  decideApproval,
  getApprovals,
  getAuditEvents,
  type ApprovalDecision,
  type ApprovalFilter,
  type AuditFilter,
  type GovernanceFailure,
} from "./governanceClient";

const APPROVALS_KEY = ["workforce", "approvals"] as const;
const AUDIT_KEY = ["workforce", "audit"] as const;

export type ListState = "loading" | "ready" | "empty" | GovernanceFailure;

function stateOf(query: { isLoading: boolean; error: unknown }, count: number): ListState {
  if (query.isLoading) return "loading";
  if (query.error) return query.error instanceof GovernanceError ? query.error.failure : "unavailable";
  return count === 0 ? "empty" : "ready";
}

export function useApprovalQueue(filter: ApprovalFilter) {
  const { accessToken } = useAuth();
  const query = useInfiniteQuery({
    queryKey: [...APPROVALS_KEY, filter, accessToken ?? "anonymous"],
    queryFn: ({ pageParam }) => getApprovals(filter, pageParam, accessToken),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    staleTime: 10_000,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return {
    state: stateOf(query, items.length),
    items,
    total: query.data?.pages[0]?.total ?? 0,
    hasMore: Boolean(query.hasNextPage),
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    refetch: () => void query.refetch(),
  };
}

export function useAuditTrail(filter: AuditFilter) {
  const { accessToken } = useAuth();
  const query = useInfiniteQuery({
    queryKey: [...AUDIT_KEY, filter, accessToken ?? "anonymous"],
    queryFn: ({ pageParam }) => getAuditEvents(filter, pageParam, accessToken),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    staleTime: 10_000,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return {
    state: stateOf(query, items.length),
    items,
    total: query.data?.pages[0]?.total ?? 0,
    hasMore: Boolean(query.hasNextPage),
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    refetch: () => void query.refetch(),
  };
}

/** Approve/reject; refreshes approvals, the audit trail and any plan views. */
export function useApprovalDecision() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (decision: ApprovalDecision) => decideApproval(decision, accessToken),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: APPROVALS_KEY });
      void client.invalidateQueries({ queryKey: AUDIT_KEY });
      void client.invalidateQueries({ queryKey: ["workforce", "projects"] });
    },
  });
}
