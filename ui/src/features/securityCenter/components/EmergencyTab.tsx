import { useOverview } from "../hooks/useTrust";
import { useT } from "../lib/useT";
import { EmergencyPanel } from "./EmergencyPanel";
import { ErrorPanel, Skeleton } from "./common";

export function EmergencyTab({ projectId }: { projectId: string | undefined }) {
  const { tt } = useT();
  const query = useOverview(projectId);
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  return <EmergencyPanel emergency={query.data.emergency} />;
}
