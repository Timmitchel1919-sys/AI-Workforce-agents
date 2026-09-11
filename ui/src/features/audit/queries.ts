import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { auditApi, queryKeys, parseResponse } from "../../api";
import type { AuditListFilters } from "../../api/endpoints/audit";

export type { AuditListFilters };

export function useAuditEvents(filters: AuditListFilters = {}) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.audit.list(filters),
    queryFn: () =>
      auditApi.listAudit(client, filters).then(parseResponse.auditPage),
  });
}
