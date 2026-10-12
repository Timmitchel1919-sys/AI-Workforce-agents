import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { getEvents, RuntimeClientError } from "../api/runtimeClient";
import { isTerminal, lastSeq, mergeEvents } from "../lib/logic";
import {
  BACKOFF_MAX_MS, BACKOFF_START_MS, EVENT_WAIT_MS, MAX_LIVE_EVENTS,
  type RuntimeEvent, type RuntimeSession, type RuntimeState,
} from "../types";

export interface LiveEventsState {
  events: RuntimeEvent[];
  liveStatus: RuntimeState | undefined;
  done: boolean;
  /** Set while the connection is down; the cursor the next request resumes from. */
  reconnecting: { fromSeq: number; attempt: number } | null;
  /** A non-retryable failure (401/403/404). Streaming stops until `restart()`. */
  fatal: unknown;
  restart: () => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

/**
 * Event-driven live log. The full session (loaded first) seeds the log and the cursor; afterwards a
 * long-poll loop (`after=<lastSeq>&wait=20000`) appends events until the server says `done`. There is no
 * fixed-interval polling: after an error the loop backs off 1 s -> 10 s and resumes from the same cursor.
 */
export function useLiveEvents(session: RuntimeSession | undefined, onActivity: () => void): LiveEventsState {
  const { accessToken } = useAuth();
  const executionId = session?.executionId;
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [liveStatus, setLiveStatus] = useState<RuntimeState | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [reconnecting, setReconnecting] = useState<LiveEventsState["reconnecting"]>(null);
  const [fatal, setFatal] = useState<unknown>(null);
  const [restartCount, setRestartCount] = useState(0);
  const [seededId, setSeededId] = useState<string | undefined>(undefined);
  const cursorRef = useRef(0);
  const activityRef = useRef(onActivity);
  const sessionRef = useRef(session);
  const loaded = Boolean(session);

  useEffect(() => {
    activityRef.current = onActivity;
    sessionRef.current = session;
  });

  // Seed from the full session exactly once per execution (before any long-poll).
  useEffect(() => {
    const current = sessionRef.current;
    if (!current || seededId === current.executionId) return;
    setSeededId(current.executionId);
    setEvents(current.events ?? []);
    cursorRef.current = Math.max(lastSeq(current.events ?? []), 0);
    setLiveStatus(undefined);
    setDone(isTerminal(current.status));
    setReconnecting(null);
    setFatal(null);
  }, [executionId, loaded, seededId]);

  const seeded = seededId !== undefined && seededId === executionId;
  useEffect(() => {
    if (!executionId || !loaded || !seeded || done || fatal) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let delay = BACKOFF_START_MS;
    let attempt = 0;
    void (async () => {
      while (!signal.aborted) {
        const startedAt = Date.now();
        try {
          const batch = await getEvents(executionId, cursorRef.current, EVENT_WAIT_MS, accessToken, signal);
          if (signal.aborted) return;
          delay = BACKOFF_START_MS;
          attempt = 0;
          setReconnecting(null);
          setLiveStatus(batch.status);
          if (batch.events.length > 0) {
            cursorRef.current = Math.max(cursorRef.current, lastSeq(batch.events));
            setEvents((current) => mergeEvents(current, batch.events, MAX_LIVE_EVENTS));
          }
          if (batch.events.length > 0 || batch.done) activityRef.current();
          if (batch.done || isTerminal(batch.status)) {
            setDone(true);
            return;
          }
          if (batch.events.length === 0 && Date.now() - startedAt < 500) await sleep(500, signal);
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof RuntimeClientError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) {
            setFatal(error);
            return;
          }
          attempt += 1;
          setReconnecting({ fromSeq: cursorRef.current, attempt });
          await sleep(delay, signal);
          delay = Math.min(delay * 2, BACKOFF_MAX_MS);
        }
      }
    })();
    return () => controller.abort();
  }, [executionId, loaded, seeded, done, fatal, accessToken, restartCount]);

  const restart = useCallback(() => {
    setFatal(null);
    setReconnecting(null);
    setRestartCount((n) => n + 1);
  }, []);

  return { events: seeded ? events : [], liveStatus, done, reconnecting, fatal, restart };
}
