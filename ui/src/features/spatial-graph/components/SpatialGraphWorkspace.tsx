import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../../i18n";
import type { GraphMode, WorkforceGraphEdge, WorkforceGraphNode, WorkforceGraphProjection } from "../../../../../contracts/graph";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { commandForKey, type CameraCommand, type CameraCommandKind } from "../lib/camera";
import { availableFilters, toGraphData } from "../lib/graphModel";
import { computeLayout } from "../lib/layout";
import { edgeStatusLabel, edgeTypeLabel, filterLabel, modeLabel, nodeTypeLabel, stateLabel } from "../lib/labels";
import { deriveView, INITIAL_VIEW_STATE, viewReducer } from "../lib/viewState";
import { AccessibleGraphList } from "./AccessibleGraphList";
import { GraphFilters } from "./GraphFilters";
import { GraphLegend } from "./GraphLegend";
import { GraphToolbar } from "./GraphToolbar";
import { ModeSwitcher } from "./ModeSwitcher";
import { NodeInspector } from "./NodeInspector";
import { SpatialGraphView } from "./SpatialGraphView";

import "../spatial-graph.css";

/**
 * Interaction shell around the 3D scene. All state here is UI-only (filter, selection,
 * isolation, camera); nothing is ever written back to the Control Plane.
 */
interface WorkspaceProps {
  graph: WorkforceGraphProjection;
  /** Requested mode (from the URL). Falls back to the projection's own mode. */
  mode?: GraphMode;
  /** True while a refetch is in flight; the previous graph stays visible. */
  busy?: boolean;
  /** Present => the mode switcher is shown. Receives the selected node so the caller can derive rootNodeId. */
  onModeChange?: (mode: GraphMode, selected: WorkforceGraphNode | null) => void;
}

export function SpatialGraphWorkspace({ graph, mode, busy = false, onModeChange }: WorkspaceProps) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [view, dispatch] = useReducer(viewReducer, INITIAL_VIEW_STATE);
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>({ seq: 1, kind: "fit" });
  const seq = useRef(1);
  const [announcement, setAnnouncement] = useState("");

  const full = useMemo(() => toGraphData(graph), [graph]);
  const positions = useMemo(() => computeLayout(graph.nodes, graph.edges, { mode: graph.mode }), [graph.nodes, graph.edges, graph.mode]);
  const derived = useMemo(() => deriveView(full, view), [full, view]);
  const filters = useMemo(() => availableFilters(graph.nodes), [graph.nodes]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const selectedNode = derived.selectedId ? (nodeById.get(derived.selectedId) ?? null) : null;
  const isolatedNode = derived.isolatedId ? (nodeById.get(derived.isolatedId) ?? null) : null;
  const expanded = derived.selectedId !== null && derived.expandedIds.includes(derived.selectedId);

  const prevGraph = useRef(graph);
  const sendCameraRef = useRef<(kind: CameraCommandKind, nodeId?: string) => void>(() => {});

  const sendCamera = useCallback((kind: CameraCommandKind, nodeId?: string) => {
    seq.current += 1;
    setCameraCommand({ seq: seq.current, kind, nodeId });
  }, []);

  sendCameraRef.current = sendCamera;

  // A new projection (e.g. after a mode switch): drop selection/isolation that no longer exists,
  // refit the camera, and announce the new view.
  useEffect(() => {
    const prev = prevGraph.current;
    if (prev === graph) return;
    prevGraph.current = graph;
    const modeChanged = prev.mode !== graph.mode;
    dispatch({ type: "prune", ids: new Set(graph.nodes.map((n) => n.id)), resetFilter: modeChanged });
    sendCameraRef.current("fit");
    if (modeChanged) {
      setAnnouncement(
        t("spatial.modeAnnouncement", {
          mode: modeLabel(t, graph.mode),
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        }),
      );
    }
  }, [graph, t]);

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
  const edgeLabelFor = useCallback((e: WorkforceGraphEdge) => (e.status ? `${edgeTypeLabel(t, e.type)} [${edgeStatusLabel(t, e.status)}]` : edgeTypeLabel(t, e.type)),
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
    if (e.key === "Escape" && derived.selectedId) {
      e.preventDefault();
      deselect();
    }
  };

  const note = graph.metadata?.note;
  const { maxNodes, depth } = graph.appliedLimits ?? { maxNodes: graph.nodes.length, depth: 0 };

  return (
    <section className="sg-workspace" aria-label={t("spatial.regionLabel")} aria-busy={busy} onKeyDown={onRegionKeyDown}>
      <div className="sg-status" role="status" aria-live="polite" aria-atomic="true">
        <p data-testid="sg-status">{status}</p>
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
      {onModeChange && (
        <ModeSwitcher mode={mode ?? graph.mode} busy={busy} onChange={(m) => onModeChange(m, selectedNode)} />
      )}
      <div className="visually-hidden" role="status" aria-live="polite" data-testid="sg-announcement">
        {announcement}
      </div>

      <GraphFilters options={filters} active={view.filter} onChange={(filter) => { dispatch({ type: "setFilter", filter }); sendCamera("fit"); }} />
      <GraphToolbar
        hasSelection={derived.selectedId !== null}
        isolated={derived.isolatedId !== null}
        expanded={expanded}
        onCamera={onCamera}
        onDeselect={deselect}
        onIsolateToggle={() => {
          if (derived.isolatedId) dispatch({ type: "isolate", id: null });
          else if (derived.selectedId) dispatch({ type: "isolate", id: derived.selectedId });
          sendCamera("fit");
        }}
        onExpandToggle={() => derived.selectedId && dispatch({ type: "toggleExpand", id: derived.selectedId })}
        onReset={reset}
      />

      <div className="sg-layout">
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
              emphasisIds={derived.emphasisIds}
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

        <div className="sg-side">
          <NodeInspector
            node={selectedNode}
            graph={full}
            onSelectNode={select}
            onClose={deselect}
          />
          <GraphLegend edges={derived.visible.edges} />
          <AccessibleGraphList
            nodes={derived.visible.nodes}
            selectedId={derived.selectedId}
            onSelect={select}
            onHover={(id) => dispatch({ type: "hover", id })}
          />
        </div>
      </div>
    </section>
  );
}
