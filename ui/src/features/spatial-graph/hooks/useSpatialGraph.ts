import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { fetchWorkforceGraph, type FetchGraphOptions } from "../api/spatialGraphClient";
import type { WorkforceGraphProjection } from "../../../../../contracts/graph";

interface Settled {
  key: string;
  projectId: string;
  graph: WorkforceGraphProjection | null;
  error: Error | null;
}

export function useSpatialGraph(projectId?: string, options: FetchGraphOptions = {}) {
  const { mode, depth, maxNodes, rootNodeId } = options;
  const key = projectId ? JSON.stringify([projectId, mode, depth, maxNodes, rootNodeId]) : null;
  const [settled, setSettled] = useState<Settled | null>(null);
  // The graph API is authenticated. The latest token is read from a ref so a silent token refresh
  // does not refetch; only signing in/out (authed flips) restarts the request.
  const { accessToken } = useAuth();
  const authed = Boolean(accessToken);
  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    if (!projectId || key === null || !authed) return;
    // Each effect run owns one request; when the inputs change (or on unmount) the cleanup
    // flags it stale, so an out-of-order response can never overwrite a newer one.
    let stale = false;
    fetchWorkforceGraph(projectId, { mode, depth, maxNodes, rootNodeId }, tokenRef.current)
      .then((graph) => {
        if (!stale) setSettled({ key, projectId, graph, error: null });
      })
      .catch((err: unknown) => {
        if (!stale) setSettled({ key, projectId, graph: null, error: err instanceof Error ? err : new Error(String(err)) });
      });
    return () => {
      stale = true;
    };
  }, [key, projectId, mode, depth, maxNodes, rootNodeId, authed]);

  const current = settled !== null && settled.key === key;
  // The previous graph stays visible while refetching, but only for the same project.
  const graph = settled && settled.projectId === projectId ? settled.graph : null;
  return {
    graph,
    loading: key !== null && authed && !current,
    error: current ? settled.error : null,
  };
}
