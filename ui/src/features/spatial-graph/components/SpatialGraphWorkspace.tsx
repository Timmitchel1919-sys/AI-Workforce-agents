import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { authContext } from "../../../auth/authContext";
import { useNodeCommand } from "../hooks/useNodeCommand";
import { CommandConfirmDialog } from "./CommandConfirmDialog";
import { useI18n, type MessageKey } from "../../../i18n";
import type { GraphMode, WorkforceGraphEdge, WorkforceGraphNode, WorkforceGraphProjection } from "../../../../../contracts/graph";
import { useFocusMode } from "../hooks/useFocusMode";
import { useFullscreen } from "../hooks/useFullscreen";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { commandForKey, type CameraCommand, type CameraCommandKind } from "../lib/camera";
import { availableFilters, matchNodes, toGraphData } from "../lib/graphModel";
import { computeLayout } from "../lib/layout";
import { describeTransition, edgeStatusLabel, edgeTypeLabel, filterLabel, modeLabel, nodeTypeLabel, stateLabel } from "../lib/labels";
import { deriveView, INITIAL_VIEW_STATE, viewReducer } from "../lib/viewState";
import { AccessibleGraphList } from "./AccessibleGraphList";
import { GraphFilters } from "./GraphFilters";
import { GraphLegend } from "./GraphLegend";
import { CameraControls } from "./CameraControls";
import { GraphToolbar } from "./GraphToolbar";
import { ModeSwitcher } from "./ModeSwitcher";
import { NodeInspector } from "./NodeInspector";
import { SpatialGraphView } from "./SpatialGraphView";

import { LiveStatusBar } from "./LiveStatusBar";
import { sourceNames } from "../lib/sources";
import { InsightsPanel } from "./InsightsPanel";
import type { SpatialInsightsReport } from "../../../../../contracts/graph";
import { traceExecutionPath } from "../lib/executionPath";
import type { LiveStatus } from "../lib/liveStatus";
import type { GraphTransition } from "../lib/graphDiff";

import "../spatial-graph.css";

interface WorkspaceProps {
  graph: WorkforceGraphProjection;
  /** Requested mode (from the URL). Falls back to the projection's own mode. */
  mode?: GraphMode;
  /** True while a refetch is in flight; the previous graph stays visible. */
  busy?: boolean;
  /** Present => the mode switcher is shown. Receives the selected node so the caller can derive rootNodeId. */
  onModeChange?: (mode: GraphMode, selected: WorkforceGraphNode | null) => void;
  /** Project selector (or static name), rendered first in the compact toolbar. */
  projectControl?: ReactNode;
  /** Grounded observations (EO-5.8). Absent => the panel is not shown. */
  insights?: { report: SpatialInsightsReport | null; loading: boolean; failed: boolean };
  /** Live transport state from useSpatialGraph. Absent => no live claim is made. */
  live?: {
    status: LiveStatus;
    lastConfirmedAt: string | null;
    transitions: readonly GraphTransition[];
    /** Uncapped running total, so announcements keep working after the history list is full. */
    transitionCount?: number;
    onRefresh?: () => void;
  };
}

/**
 * Interaction shell around the 3D scene. All state here is UI-only (filter, search, selection,
 * isolation, camera, focus mode); nothing is ever written back to the Control Plane.
 * The page keys this component by project, so every piece of state below is per project.
 */
export function SpatialGraphWorkspace({ graph, mode, busy = false, onModeChange, projectControl, live, insights }: WorkspaceProps) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [view, dispatch] = useReducer(viewReducer, INITIAL_VIEW_STATE);
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>({ seq: 1, kind: "fit" });
  const seq = useRef(1);
  const [announcement, setAnnouncement] = useState("");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLElement | null>(null);
  const { active: focusActive, toggle: toggleFocus, exit: exitFocus, triggerRef, exitRef } = useFocusMode(rootRef);
  const fullscreen = useFullscreen(rootRef);
  // The command state machine and its dialog belong to the workspace (not the inspector): a request
  // in flight must survive the inspector unmounting, and the confirmation must not be confined by
  // the inspector panel's blur/overflow. Bound to the project; the graph is re-read on settle.
  const account = useContext(authContext);
  const command = useNodeCommand(graph.projectId, account?.accessToken ?? null, live?.onRefresh);

  const full = useMemo(() => toGraphData(graph), [graph]);
  const positions = useMemo(
    () => computeLayout(graph.nodes, graph.edges, { mode: graph.mode }),
    [graph.nodes, graph.edges, graph.mode],
  );
  const derived = useMemo(() => deriveView(full, view), [full, view]);
  const filters = useMemo(() => availableFilters(graph.nodes), [graph.nodes]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const matchIds = useMemo(() => matchNodes(derived.visible.nodes, query), [derived.visible.nodes, query]);
  const listNodes = useMemo(
    () => (matchIds ? derived.visible.nodes.filter((n) => matchIds.has(n.id)) : derived.visible.nodes),
    [derived.visible.nodes, matchIds],
  );

  const selectedNode = derived.selectedId ? (nodeById.get(derived.selectedId) ?? null) : null;
  const isolatedNode = derived.isolatedId ? (nodeById.get(derived.isolatedId) ?? null) : null;
  const expanded = derived.selectedId !== null && derived.expandedIds.includes(derived.selectedId);

  const sendCamera = useCallback((kind: CameraCommandKind, nodeId?: string) => {
    seq.current += 1;
    setCameraCommand({ seq: seq.current, kind, nodeId });
  }, []);

  const prevGraph = useRef(graph);
  // A new projection (e.g. after a mode switch): drop selection/isolation that no longer exists,
  // refit the camera, and announce the new view.
  useEffect(() => {
    const prev = prevGraph.current;
    if (prev === graph) return;
    prevGraph.current = graph;
    const modeChanged = prev.mode !== graph.mode;
    dispatch({ type: "prune", ids: new Set(graph.nodes.map((n) => n.id)), resetFilter: modeChanged });
    // A live update must not yank the camera out from under the operator: refit only when the
    // view itself changed (mode or root), never for a routine state change.
    // The one exception: a sparse view that first fills in (e.g. the first execution session
    // appears in an empty EXECUTION view) is refit, or the new nodes could sit off-screen unseen.
    const firstFill = prev.nodes.length <= 3 && graph.nodes.length > prev.nodes.length;
    if (modeChanged || prev.rootNodeId !== graph.rootNodeId || firstFill) sendCamera("fit");
    if (modeChanged) {
      setAnnouncement(
        t("spatial.modeAnnouncement", {
          mode: modeLabel(t, graph.mode),
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        }),
      );
    }
  }, [graph, t, sendCamera]);

  // Announce only meaningful live changes: degradation, recovery and real state transitions.
  // Routine successful polls are silent, so a screen reader is never spammed. One block builds
  // the whole message so a recovery and a transition in the same update cannot overwrite each
  // other, and transitions are counted by the uncapped total, not by the (capped) list length.
  const liveStatus = live?.status;
  const transitions = live?.transitions;
  const totalTransitions = live?.transitionCount ?? transitions?.length ?? 0;
  // Derived during render from the previous values (React's recommended pattern), not in an effect.
  const isBad = (st: LiveStatus | undefined) => st === "reconnecting" || st === "degraded" || st === "offline";
  const [seen, setSeen] = useState({ status: liveStatus, total: totalTransitions, degraded: isBad(liveStatus) });
  if (seen.status !== liveStatus || seen.total !== totalTransitions) {
    const parts: string[] = [];
    let degraded = seen.degraded;
    if (liveStatus !== undefined && liveStatus !== seen.status) {
      // "refreshing" between offline and live is transient: recovery is judged against the last
      // BAD status, not merely the previous one, so it is never lost. A view that mounts already
      // degraded starts with `degraded` true, so its eventual recovery is announced too.
      if (isBad(liveStatus)) {
        degraded = true;
        parts.push(t(`spatial.live.${liveStatus}` as MessageKey));
      } else if (liveStatus === "live" && degraded) {
        degraded = false;
        parts.push(t("spatial.live.live"));
      }
    }
    const fresh = totalTransitions - seen.total;
    if (fresh > 0 && transitions && transitions.length > 0) {
      const shown = transitions.slice(-Math.min(fresh, 3, transitions.length)).map((tr) => describeTransition(t, tr));
      parts.push(shown.join(" ") + (fresh > 3 ? ` (+${fresh - 3})` : ""));
    }
    setSeen({ status: liveStatus, total: totalTransitions, degraded });
    if (parts.length > 0) setAnnouncement(parts.join(" "));
  }

  const select = useCallback(
    (id: string) => {
      dispatch({ type: "select", id });
      const n = nodeById.get(id);
      if (n) {
        setAnnouncement(
          t("spatial.selectedAnnouncement", {
            type: nodeTypeLabel(t, n.type),
            label: n.label,
            state: stateLabel(t, n.state),
          }),
        );
      }
    },
    [nodeById, t],
  );

  const deselect = useCallback(() => {
    dispatch({ type: "deselect" });
    setAnnouncement(t("spatial.deselectedAnnouncement"));
  }, [t]);

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    setQuery("");
    sendCamera("reset");
    setAnnouncement("");
  }, [sendCamera]);

  const onCamera = useCallback(
    (kind: CameraCommandKind) => sendCamera(kind, kind === "focus" ? (derived.selectedId ?? undefined) : undefined),
    [sendCamera, derived.selectedId],
  );

  const status = isolatedNode
    ? t("spatial.statusIsolated", {
        nodes: derived.visible.nodes.length,
        edges: derived.visible.edges.length,
        filter: filterLabel(t, view.filter),
        label: isolatedNode.label,
      })
    : t("spatial.status", {
        nodes: derived.visible.nodes.length,
        edges: derived.visible.edges.length,
        filter: filterLabel(t, view.filter),
      });

  const tooltipFor = useCallback(
    (n: WorkforceGraphNode) => `${nodeTypeLabel(t, n.type)}: ${n.label} (${stateLabel(t, n.state)})`,
    [t],
  );
  const edgeLabelFor = useCallback(
    (e: WorkforceGraphEdge) =>
      e.status ? `${edgeTypeLabel(t, e.type)} [${edgeStatusLabel(t, e.status)}]` : edgeTypeLabel(t, e.type),
    [t],
  );

  const onCanvasKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const kind = commandForKey(e.key, e.shiftKey);
    if (kind) {
      e.preventDefault();
      onCamera(kind);
    }
  };

  const onRegionKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // In Focus Mode Escape leaves the mode (handled at window level); otherwise it clears the selection.
    if (e.key === "Escape" && !focusActive && derived.selectedId) {
      e.preventDefault();
      deselect();
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && listNodes.length > 0 && matchIds) {
      e.preventDefault();
      select(listNodes[0].id);
      sendCamera("focus", listNodes[0].id);
    } else if (e.key === "Escape" && query !== "") {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
    }
  };

  const note = graph.metadata?.note;
  const { maxNodes, depth } = graph.appliedLimits ?? { maxNodes: graph.nodes.length, depth: 0 };
  // Execution path: following a selected session/ChangeSet/… through its real lifecycle edges.
  const pathIds = useMemo(
    () => (derived.emphasisIds ? null : traceExecutionPath(derived.visible.edges, derived.selectedId)),
    [derived.emphasisIds, derived.visible.edges, derived.selectedId],
  );
  const emphasis = matchIds ?? derived.emphasisIds ?? pathIds;

  return (
    <section
      ref={rootRef}
      className={`sg-workspace${focusActive ? " sg-workspace--focus" : ""}`}
      aria-label={t("spatial.regionLabel")}
      aria-busy={busy}
      data-focus-mode={focusActive}
      tabIndex={-1}
      onKeyDown={onRegionKeyDown}
    >
      {focusActive && (
        <button type="button" ref={exitRef} className="sg-btn sg-exit-focus" onClick={exitFocus}>
          {t("spatial.focusMode.exit")}
        </button>
      )}

      <div className="sg-topbar">
        {projectControl}
        {onModeChange && (
          <ModeSwitcher mode={mode ?? graph.mode} busy={busy} onChange={(m) => onModeChange(m, selectedNode)} />
        )}
        <div className="sg-topbar__end">
          <button type="button" ref={triggerRef} className="sg-btn" aria-pressed={focusActive} onClick={toggleFocus}>
            {t("spatial.focusMode.enter")}
          </button>
          {fullscreen.supported && (
            <button type="button" className="sg-btn" aria-pressed={fullscreen.active} onClick={() => void fullscreen.toggle()}>
              {fullscreen.active ? t("spatial.fullscreen.exit") : t("spatial.fullscreen.enter")}
            </button>
          )}
        </div>
      </div>

      <div className="sg-controls">
        <GraphFilters
          options={filters}
          active={view.filter}
          onChange={(filter) => {
            dispatch({ type: "setFilter", filter });
            sendCamera("fit");
          }}
        />
        <div className="sg-search">
          <label className="visually-hidden" htmlFor="sg-search-input">
            {t("spatial.search.label")}
          </label>
          <input
            id="sg-search-input"
            type="search"
            className="sg-input"
            placeholder={t("spatial.search.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>
        <GraphToolbar
          hasSelection={derived.selectedId !== null}
          isolated={derived.isolatedId !== null}
          expanded={expanded}
          onDeselect={deselect}
          onIsolateToggle={() => {
            if (derived.isolatedId) dispatch({ type: "isolate", id: null });
            else if (derived.selectedId) dispatch({ type: "isolate", id: derived.selectedId });
            sendCamera("fit");
          }}
          onExpandToggle={() => derived.selectedId && dispatch({ type: "toggleExpand", id: derived.selectedId })}
        />
      </div>

      {live && (
        <LiveStatusBar
          status={live.status}
          lastConfirmedAt={live.lastConfirmedAt}
          transitions={live.transitions}
          onRefresh={live.onRefresh}
        />
      )}
      <div className="sg-status" role="status" aria-live="polite" aria-atomic="true">
        <p data-testid="sg-status">{status}</p>
        {pathIds && !matchIds && (
          <p data-testid="sg-path-status">{t("spatial.pathTrace", { count: pathIds.size })}</p>
        )}
        {matchIds && (
          <p data-testid="sg-search-status">{t("spatial.search.results", { count: matchIds.size })}</p>
        )}
        {fullscreen.error && <p className="sg-notice">{t("spatial.fullscreen.failed")}</p>}
        {note && (
          <p className="sg-notice sg-notice--info" data-testid="sg-note">
            {t("spatial.note", { note })}
          </p>
        )}
        {graph.metadata?.unavailableSources && (
          <p className="sg-notice" data-testid="sg-unavailable-sources">
            {t("spatial.live.unavailableSources", { sources: sourceNames(t, graph.metadata.unavailableSources) })}
          </p>
        )}
        {graph.metadata?.notConfiguredSources && (
          <p className="sg-notice sg-notice--info" data-testid="sg-not-configured">
            {t("spatial.live.notConfigured", { sources: sourceNames(t, graph.metadata.notConfiguredSources) })}
          </p>
        )}
        {graph.truncated && (
          <p className="sg-notice" data-testid="sg-truncated">
            {t("spatial.truncated", { maxNodes, depth })}
          </p>
        )}
      </div>
      <div className="visually-hidden" role="status" aria-live="polite" data-testid="sg-announcement">
        {announcement}
      </div>

      <div className="sg-layout">
        <div className="sg-stage">
          <div
            className="sg-canvas-frame"
            tabIndex={0}
            role="group"
            aria-label={t("spatial.canvasLabel")}
            onKeyDown={onCanvasKeyDown}
          >
            <div aria-hidden="true" className="sg-canvas-hidden">
              <SpatialGraphView
                nodes={derived.visible.nodes}
                edges={derived.visible.edges}
                positions={positions}
                selectedId={derived.selectedId}
                hoveredId={view.hoveredId}
                emphasisIds={emphasis}
                cameraCommand={cameraCommand}
                reducedMotion={reducedMotion}
                tooltipFor={tooltipFor}
                edgeLabelFor={edgeLabelFor}
                onHover={(id) => dispatch({ type: "hover", id })}
                onSelect={select}
                onDeselect={deselect}
              />
            </div>
          </div>
          <CameraControls hasSelection={derived.selectedId !== null} onCamera={onCamera} onReset={reset} />
          {selectedNode && (
            <div className="sg-drawer">
              <NodeInspector node={selectedNode} graph={full} onSelectNode={select} onClose={deselect} onCommandBegin={command.begin} commandBusy={command.busy} />
            </div>
          )}
        </div>

        <div className="sg-side">
          <AccessibleGraphList
            nodes={listNodes}
            selectedId={derived.selectedId}
            onSelect={select}
            onHover={(id) => dispatch({ type: "hover", id })}
          />
          {insights && (
            <InsightsPanel
              report={insights.report}
              loading={insights.loading}
              failed={insights.failed}
              isInView={(id) => nodeById.has(id)}
              onSelectNode={(id) => {
                select(id);
                sendCamera("focus", id);
              }}
            />
          )}
          <GraphLegend edges={derived.visible.edges} />
        </div>
      </div>
      {/* Rendered at the workspace root: outside the inspector (no blur/overflow containing block),
          inside Focus Mode's non-inert area, and independent of what is selected. */}
      <CommandConfirmDialog
        state={command.state}
        onConfirm={(r) => void command.confirm(r)}
        onCancel={command.cancel}
        onDismiss={command.dismiss}
        restoreFocusTo={() => rootRef.current}
      />
    </section>
  );
}
