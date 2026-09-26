import { useState, useEffect } from "react";
import { fetchWorkforceGraph } from "../api/spatialGraphClient";
import type { WorkforceGraphProjection } from "../../../../../contracts/graph";

export function useSpatialGraph(projectId?: string) {
  const [graph, setGraph] = useState<WorkforceGraphProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!projectId) return;

    let mounted = true;
    setLoading(true);
    fetchWorkforceGraph(projectId)
      .then((data) => {
        if (mounted) {
          setGraph(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err);
          setGraph(null);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [projectId]);

  return { graph, loading, error };
}
