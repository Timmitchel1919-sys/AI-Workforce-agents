import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { approvalsApi, queryKeys, parseResponse } from "../../api";
import type { ApprovalListFilters } from "../../api/endpoints/approvals";

export type { ApprovalListFilters };

export function useApprovals(filters: ApprovalListFilters = {}) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.approvals.list(filters),
    queryFn: () =>
      approvalsApi
        .listApprovals(client, filters)
        .then(parseResponse.approvalList),
  });
}
