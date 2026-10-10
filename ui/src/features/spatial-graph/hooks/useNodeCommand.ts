import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { executeNodeCommand, newSpatialCorrelationId, type CommandResult } from "../api/spatialCommandClient";
import type { NodeAction } from "../lib/nodeActions";

export type CommandPhase =
  | { phase: "idle" }
  | { phase: "confirming"; action: NodeAction; nodeLabel: string }
  /** Requesting… — the server has NOT confirmed anything yet. Never shown as success. */
  | { phase: "requesting"; action: NodeAction; nodeLabel: string }
  | { phase: "done"; action: NodeAction; nodeLabel: string; result: CommandResult };

/**
 * Per-project command state machine: idle → confirming → requesting → done.
 * - Every state-changing action needs an explicit confirmation.
 * - A command in flight blocks any other (double-click / repeated Enter / two targets), so one
 *   click can never produce two requests; a failed or unknown outcome is NEVER auto-retried.
 * - It is bound to `projectId`: switching project resets it and drops a late reply, so a pending
 *   command from project A can never surface in (or act on) project B.
 * - After the server answers (success OR failure) `onSettled` re-reads authoritative state; the
 *   graph is never updated optimistically.
 */
export function useNodeCommand(projectId: string, accessToken: string | null, onSettled?: () => void) {
  const [state, setState] = useState<{ projectId: string; value: CommandPhase }>({ projectId, value: { phase: "idle" } });
  const inFlight = useRef(false);
  // Identifies the CURRENT request, so a late reply from an earlier project can never clear the
  // in-flight guard of a request that belongs to the project the operator is in now.
  const requestId = useRef(0);
  const projectRef = useRef(projectId);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);
  useEffect(() => {
    projectRef.current = projectId;
    requestId.current += 1;
    inFlight.current = false;
  }, [projectId]);

  // A phase from another project is never visible.
  const value = useMemo<CommandPhase>(
    () => (state.projectId === projectId ? state.value : { phase: "idle" }),
    [state, projectId],
  );
  const set = useCallback((next: CommandPhase) => setState({ projectId: projectRef.current, value: next }), []);

  const begin = useCallback(
    (action: NodeAction, nodeLabel: string) => {
      if (inFlight.current) return;
      set({ phase: "confirming", action, nodeLabel });
    },
    [set],
  );

  const cancel = useCallback(() => {
    if (inFlight.current) return; // cannot abandon a request already sent
    set({ phase: "idle" });
  }, [set]);

  const confirm = useCallback(
    async (reason: string) => {
      if (inFlight.current || value.phase !== "confirming") return;
      const { action, nodeLabel } = value;
      if (action.reason === "required" && reason.trim() === "") return; // validated again by the server
      inFlight.current = true;
      const mine = ++requestId.current;
      const startedFor = projectRef.current;
      set({ phase: "requesting", action, nodeLabel });
      const result = await executeNodeCommand(action, reason, accessToken, newSpatialCorrelationId());
      if (requestId.current === mine) inFlight.current = false;
      if (projectRef.current !== startedFor) return; // the operator moved to another project
      setState({ projectId: startedFor, value: { phase: "done", action, nodeLabel, result } });
      settledRef.current?.();
    },
    [value, accessToken, set],
  );

  const dismiss = useCallback(() => {
    if (inFlight.current) return;
    set({ phase: "idle" });
  }, [set]);

  return { state: value, begin, cancel, confirm, dismiss, busy: value.phase === "requesting" };
}
