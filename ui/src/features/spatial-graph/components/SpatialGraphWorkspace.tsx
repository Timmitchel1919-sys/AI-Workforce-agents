import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../../../i18n";
import type { GraphMode, WorkforceGraphEdge, WorkforceGraphNode, WorkforceGraphProjection } from "../../../../../contracts/graph";
import { useFocusMode } from "../hooks/useFocusMode";
import { useFullscreen } from "../hooks/useFullscreen";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { commandForKey, type CameraCommand, type CameraCommandKind } from "../lib/camera";
import { availableFilters, matchNodes, toGraphData } from "../lib/graphModel";
import { computeLayout } from "../lib/layout";
import { edgeStatusLabel, edgeTypeLabel, filterLabel, modeLabel, nodeTypeLabel, stateLabel } from "../lib/labels";
import { deriveView, INITIAL_VIEW_STATE, viewReducer } from "../lib/viewState";
import { AccessibleGraphList } from "./AccessibleGraphList";
import { GraphFilters } from "./GraphFilters";
import { GraphLegend } from "./GraphLegend";
import { CameraControls } from "./CameraControls";
import { GraphToolbar } from "./GraphToolbar";
import { ModeSwitcher } from "./ModeSwitcher";
import { NodeInspector } from "./NodeInspector";
import { SpatialGraphView } from "./SpatialGraphView";

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
}

/**
 * Interaction shell around the 3D scene. All state here is UI-only (filter, search, selection,
 * isolation, camera, focus mode); nothing is ever written back to the Control Plane.
 * The page keys this component by project, so every piece of state below is per project.
 */
export function SpatialGraphWorkspace({ graph, mode, busy = false, onModeChange, projectControl }: WorkspaceProps) {
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
    sendCamera("fit");
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
  const emphasis = matchIds ?? derived.emphasisIds;

  return (
    <section
      ref={rootRef}
      className={`sg-workspace${focusActive ? " sg-workspace--focus" : ""}`}
      aria-label={t("spatial.regionLabel")}
      aria-busy={busy}
      data-focus-mode={focusActive}
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

      <div className="sg-status" role="status" aria-live="polite" aria-atomic="true">
        <p data-testid="sg-status">{status}</p>
        {matchIds && (
          <p data-testid="sg-search-status">{t("spatial.search.results", { count: matchIds.size })}</p>
        )}
        {fullscreen.error && <p className="sg-notice">{t("spatial.fullscreen.failed")}</p>}
        {note && (
          <p className="sg-notice sg-notice--info" data-testid="sg-note">
            {t("spatial.note", { note })}
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
              <NodeInspector node={selectedNode} graph={full} onSelectNode={select} onClose={deselect} />
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
          <GraphLegend edges={derived.visible.edges} />
        </div>
      </div>
    </section>
  );
}
