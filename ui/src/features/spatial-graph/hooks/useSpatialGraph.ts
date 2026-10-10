import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  fetchWorkforceGraph,
  pollWorkforceGraph,
  type FetchGraphOptions,
} from "../api/spatialGraphClient";
import { appendBounded, diffGraphs, type GraphTransition } from "../lib/graphDiff";
import { deriveLiveStatus, LIVE_LIMITS, nextDelayMs, type LiveStatus } from "../lib/liveStatus";
import type { WorkforceGraphProjection } from "../../../../../contracts/graph";

export interface UseSpatialGraphOptions extends FetchGraphOptions {
  /** Poll for authoritative changes (default true). `false` = load once, status is never "live". */
  live?: boolean;
  pollIntervalMs?: number;
}

interface View {
  key: string;
  projectId: string;
  graph: WorkforceGraphProjection | null;
  /** Only meaningful while no graph has loaded; a later failure degrades `live` instead. */
  error: Error | null;
  lastConfirmedAt: string | null;
  failures: number;
  /** A visible (initial / manual / resume) request is in flight. Routine polls do not set it. */
  busy: boolean;
  /** Bounded, newest-last state changes revealed by authoritative snapshots. */
  transitions: GraphTransition[];
  /** Monotonic count of every transition ever observed (the list above is capped; this is not). */
  transitionCount: number;
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/**
 * Snapshot + live updates. The first response is an authorised authoritative snapshot; after that
 * the hook re-asks the server "has revision R changed?" on a serialized, backing-off loop. It never
 * applies an older snapshot over a newer one, pauses while the tab is hidden, and reports a status
 * derived from what the transport actually did (never "live" for a manual-only refresh).
 */
export function useSpatialGraph(projectId?: string, options: UseSpatialGraphOptions = {}) {
  const { mode, depth, maxNodes, rootNodeId, live = true, pollIntervalMs = LIVE_LIMITS.intervalMs } = options;
  const key = projectId ? JSON.stringify([projectId, mode, depth, maxNodes, rootNodeId]) : null;
  const [view, setView] = useState<View | null>(null);
  const [env, setEnv] = useState(() => ({
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    hidden: typeof document === "undefined" ? false : document.visibilityState === "hidden",
  }));
  // The graph API is authenticated. The latest token is read from a ref so a silent token refresh
  // does not restart the loop; only signing in/out (authed flips) does.
  const { accessToken } = useAuth();
  const authed = Boolean(accessToken);
  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);
  const wakeRef = useRef<((visible: boolean) => void) | null>(null);

  useEffect(() => {
    const sync = () =>
      setEnv({ online: navigator.onLine, hidden: document.visibilityState === "hidden" });
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  useEffect(() => {
    if (!projectId || key === null || !authed) return;
    // Each effect run owns one loop; a change of inputs or unmount flags it stopped, so a response
    // that arrives late can never overwrite a newer one or touch state after cleanup.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let applied: WorkforceGraphProjection | null = null;
    let failures = 0;
    let transitions: GraphTransition[] = [];
    let transitionCount = 0;
    let confirmedAt: string | null = null;
    // Consecutive replies older than what is shown. One is treated as a stale/out-of-order reply
    // and discarded; a persistent one means the server's clock (another instance) is simply behind,
    // so it is accepted rather than freezing the view on old data forever.
    let olderReplies = 0;
    let inFlight = false;
    let authStopped = false;
    const opts = { mode, depth, maxNodes, rootNodeId };

    const patch = (p: Partial<View>) =>
      setView((v) =>
        v && v.key === key
          ? { ...v, ...p }
          : {
              key,
              projectId,
              // Same project, different mode/root: keep showing the previous graph until the new one
              // arrives. A different project never inherits anything.
              graph: v && v.projectId === projectId ? v.graph : null,
              error: null,
              lastConfirmedAt: null,
              failures: 0,
              busy: false,
              transitions: [],
              transitionCount: 0,
              ...p,
            },
      );

    const schedule = () => {
      if (stopped || !live || authStopped) return;
      clearTimeout(timer);
      // A hidden tab makes no requests; the visibility listener wakes the loop on return.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      timer = setTimeout(() => void run(false), nextDelayMs(failures, pollIntervalMs));
    };

    const run = async (visible: boolean): Promise<void> => {
      if (stopped || inFlight) return; // serialized: never two requests for one loop
      // A timer armed before the tab was hidden must not fire a request while hidden.
      if (!visible && document.visibilityState === "hidden") return;
      inFlight = true;
      // The initial load is already "refreshing" (nothing confirmed yet); only a re-request of an
      // already-confirmed view needs the explicit busy flag.
      if (visible && applied) patch({ busy: true });
      try {
        const result = applied
          ? await pollWorkforceGraph(projectId, opts, tokenRef.current, applied.revision)
          : await fetchWorkforceGraph(projectId, opts, tokenRef.current);
        if (stopped) return;
        failures = 0;
        if ("unchanged" in result) {
          // Confirmation time only ever moves forward.
          if (confirmedAt === null || result.generatedAt >= confirmedAt) confirmedAt = result.generatedAt;
          olderReplies = 0;
          patch({ lastConfirmedAt: confirmedAt, failures: 0, busy: false, error: null });
        } else if (applied && result.generatedAt < applied.generatedAt && olderReplies < 1) {
          // Older than what is already shown: STALE != CURRENT. Discard; the next poll re-asks.
          olderReplies += 1;
          patch({ failures: 0, busy: false });
        } else {
          olderReplies = 0;
          const fresh = applied ? diffGraphs(applied, result) : [];
          transitions = appendBounded(transitions, fresh);
          transitionCount += fresh.length;
          applied = result;
          if (confirmedAt === null || result.generatedAt >= confirmedAt) confirmedAt = result.generatedAt;
          patch({ graph: result, error: null, lastConfirmedAt: confirmedAt, failures: 0, busy: false, transitions, transitionCount });
        }
      } catch (err) {
        if (stopped) return;
        // An auth failure will not fix itself by retrying (the client already retried a 401 once
        // with a fresh token): stop polling, show degraded, and let a manual refresh try again.
        const status = (err as { status?: unknown } | null)?.status;
        authStopped = status === 401 || status === 403;
        failures = authStopped ? LIVE_LIMITS.degradedAfterFailures : failures + 1;
        // Keep the last-known graph on screen; the degraded status tells the truth about it.
        patch({ failures, busy: false, ...(applied ? {} : { graph: null, error: asError(err) }) });
      } finally {
        inFlight = false;
        schedule();
      }
    };

    wakeRef.current = (visible) => {
      if (stopped) return;
      authStopped = false; // an explicit refresh / resume may try again
      clearTimeout(timer);
      void run(visible);
    };
    const onWake = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine) wakeRef.current?.(true);
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    void run(true);
    return () => {
      stopped = true;
      clearTimeout(timer);
      wakeRef.current = null;
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [key, projectId, mode, depth, maxNodes, rootNodeId, authed, live, pollIntervalMs]);

  const refresh = useCallback(() => wakeRef.current?.(true), []);

  // Signed out: nothing from the previous identity may remain on screen.
  const current = authed && view !== null && view.key === key;
  // The previous graph stays visible while refetching, but only for the same project.
  const graph = authed && view && view.projectId === projectId ? view.graph : null;
  const derived: LiveStatus = deriveLiveStatus({
    enabled: key !== null && authed,
    online: env.online,
    hidden: env.hidden,
    busy: current ? view.busy : true,
    consecutiveFailures: current ? view.failures : 0,
    hasConfirmed: current && view.lastConfirmedAt !== null,
  });
  // A single-load view (live=false) is never labelled "live"; it is simply not polling.
  const status: LiveStatus = key !== null && authed && !live && derived !== "offline" ? "paused" : derived;
  return {
    graph,
    loading: key !== null && authed && !current,
    error: current ? view.error : null,
    live: status,
    lastConfirmedAt: current ? view.lastConfirmedAt : null,
    transitions: current ? view.transitions : [],
    transitionCount: current ? view.transitionCount : 0,
    refresh,
  };
}
