import { useEffect, useRef, useState } from "react";
import { fetchWorkforceGraph, type FetchGraphOptions } from "../api/spatialGraphClient";
import type { WorkforceGraphProjection } from "../../../../../contracts/graph";

export function useSpatialGraph(projectId?: string, options: FetchGraphOptions = {}) {
  const [graph, setGraph] = useState<WorkforceGraphProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const latestRequest = useRef(0);

  const { mode, depth, maxNodes, rootNodeId } = options;

  useEffect(() => {
    if (!projectId) return;

    // Every request gets a sequence number; only the newest may write state, so an
    // out-of-order (slower, older) response can never overwrite a newer one.
    const requestId = ++latestRequest.current;
    const isCurrent = () => latestRequest.current === requestId;

    // Keep the previous graph for the same project visible while refetching (mode switch);
    // a graph that belongs to another project is dropped immediately.
    setGraph((prev) => (prev && prev.projectId === projectId ? prev : null));
    setLoading(true);
    fetchWorkforceGraph(projectId, { mode, depth, maxNodes, rootNodeId })
      .then((data) => {
        if (!isCurrent()) return;
        setGraph(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!isCurrent()) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setGraph(null);
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });

    return () => {
      // Invalidate this request on unmount / dependency change.
      if (latestRequest.current === requestId) latestRequest.current++;
    };
  }, [projectId, mode, depth, maxNodes, rootNodeId]);

  return { graph, loading, error };
}
