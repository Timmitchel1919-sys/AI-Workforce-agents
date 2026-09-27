import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { fetchSpatialInsights } from "../api/spatialInsightsClient";
import type { SpatialInsightsReport } from "../../../../../contracts/graph";

interface Settled {
  key: string;
  report: SpatialInsightsReport | null;
  failed: boolean;
}

/**
 * Insights follow the graph: they are re-read whenever the graph's revision moves, so there is no
 * second polling loop and no second notion of "live". A reply for an earlier project/revision is
 * discarded, and the last good report stays visible while a new one loads (same project only).
 * A failure is reported as unavailable — never as "no findings".
 */
export function useSpatialInsights(projectId: string | undefined, graphRevision: number | undefined) {
  const { accessToken } = useAuth();
  const authed = Boolean(accessToken);
  const key = projectId && graphRevision !== undefined ? `${projectId}|${graphRevision}` : null;
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!projectId || key === null || !authed) return;
    let stale = false;
    fetchSpatialInsights(projectId, accessToken)
      .then((report) => {
        if (!stale) setSettled({ key, report, failed: false });
      })
      .catch(() => {
        if (!stale) setSettled({ key, report: null, failed: true });
      });
    return () => {
      stale = true;
    };
    // The token is read at request time; a silent refresh must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, projectId, authed]);

  const current = settled !== null && settled.key === key;
  // A report about ANOTHER project is never shown.
  const report = settled?.report && settled.report.projectId === projectId ? settled.report : null;
  return {
    report,
    loading: key !== null && authed && !current,
    failed: current && settled.failed,
  };
}
