import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "../../../components/ui";
import {
  GRAPH_HEIGHT, GRAPH_WIDTH, INITIAL_VIEW, centerOn, clampZoom, layoutGraph, matchNodes, relationsOf, truncateLabel, visibleEdges, zoomAround,
  projectSearch, type PlacedNode, type View,
} from "../lib/logic";
import { useT } from "../lib/useT";
import { GRAPH_NODE_KINDS, type GraphEdge, type GraphNodeKind, type GraphResponse } from "../types";
import { Notice, Tag } from "./common";

const R = 16;

function Shape({ kind }: { kind: GraphNodeKind }) {
  switch (kind) {
    case "PROJECT": return <rect x={-R - 6} y={-R + 2} width={(R + 6) * 2} height={(R - 2) * 2} rx={8} />;
    case "COMPONENT": return <rect x={-R + 2} y={-R + 2} width={(R - 2) * 2} height={(R - 2) * 2} rx={3} />;
    case "AREA": return <polygon points={`0,${-R - 2} ${R + 2},0 0,${R + 2} ${-R - 2},0`} />;
    case "INTEGRATION": return <polygon points={`0,${-R - 1} ${R + 2},${R - 3} ${-R - 2},${R - 3}`} />;
    case "MEMORY": return <circle r={R - 5} />;
    case "OTHER": return <circle r={R - 3} strokeDasharray="4 3" />;
    case "TECHNOLOGY":
    default: return <circle r={R} />;
  }
}

function LegendShape({ kind }: { kind: GraphNodeKind }) {
  return (
    <svg width="22" height="22" viewBox="-22 -22 44 44" aria-hidden className={`kn-node kn-node--${kind}`}><Shape kind={kind} /></svg>
  );
}

interface Props { graph: GraphResponse }

/** Deterministic concentric SVG graph with zoom/pan (buttons, wheel, keyboard), search, relation filter and a table fallback. */
export function GraphExplorer({ graph }: Props) {
  const { tt, label } = useT();
  const location = useLocation();
  const [mode, setMode] = useState<"graph" | "list">("graph");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const placed = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph.nodes, graph.edges]);
  const byId = useMemo(() => new Map<string, PlacedNode>(placed.map((n) => [n.id, n])), [placed]);
  const edges = useMemo(() => visibleEdges(graph.edges, hidden).filter((e) => byId.has(e.from) && byId.has(e.to)), [graph.edges, hidden, byId]);
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [graph.edges]);
  const matches = useMemo(() => matchNodes(graph.nodes, query), [graph.nodes, query]);
  const matchIds = useMemo(() => new Set(matches.map((n) => n.id)), [matches]);
  const relations = useMemo(() => (selected ? relationsOf(selected, edges) : []), [selected, edges]);
  const neighborIds = useMemo(() => new Set(relations.map((r) => r.neighborId)), [relations]);
  const selectedNode = selected ? byId.get(selected) : undefined;

  // Wheel zoom needs a non-passive listener so the page does not scroll while zooming the graph.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || mode !== "graph") return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((v) => zoomAround(v, event.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode]);

  const focusNode = (id: string) => {
    setSelected(id);
    const node = byId.get(id);
    if (node) setView((v) => centerOn(node.x, node.y, v.k));
  };

  const toggleType = (type: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || event.buttons === 0) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const ratio = rect && rect.width > 0 ? GRAPH_WIDTH / rect.width : 1;
    const dx = (event.clientX - d.x) * ratio;
    const dy = (event.clientY - d.y) * ratio;
    d.x = event.clientX;
    d.y = event.clientY;
    d.moved = true;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const endDrag = () => { drag.current = null; };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = 40;
    const map: Record<string, () => void> = {
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
      "+": () => setView((v) => zoomAround(v, 1.2)),
      "=": () => setView((v) => zoomAround(v, 1.2)),
      "-": () => setView((v) => zoomAround(v, 1 / 1.2)),
      "0": () => setView(INITIAL_VIEW),
    };
    const action = map[event.key];
    if (action && event.target === event.currentTarget) {
      event.preventDefault();
      action();
    }
  };

  const selectKey = (id: string) => (event: ReactKeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      setSelected(id);
    }
  };

  const nodeLabel = (id: string) => byId.get(id)?.label ?? id;
  const memoryId = selectedNode && selectedNode.kind === "MEMORY" && selectedNode.id.startsWith("mem:") ? selectedNode.id.slice(4) : null;
  const tabStops = placed.length <= 80;

  const inspector = (
    <aside className="kn-panel" aria-labelledby="kn-inspect-heading" data-testid="graph-inspector">
      <h3 id="kn-inspect-heading" className="kn-panel__title">{tt("graph.inspectTitle")}</h3>
      {!selectedNode ? <p className="kn-muted">{tt("graph.inspectHint")}</p> : (
        <div className="kn-stack">
          <p className="kn-strong">{selectedNode.label}</p>
          <div className="kn-row__meta"><Tag>{label("nodeKind", selectedNode.kind)}</Tag><code className="kn-inline-code">{selectedNode.id}</code></div>
          {memoryId ? (
            <Link className="kn-link" to={`/knowledge/memories/${encodeURIComponent(memoryId)}${projectSearch(location.search)}`}>{tt("graph.openMemory")}</Link>
          ) : null}
          <h4 className="kn-sub__title">{tt("graph.relations", { count: relations.length })}</h4>
          {relations.length === 0 ? <p className="kn-muted">{tt("graph.noRelations")}</p> : (
            <ul className="kn-list">
              {relations.map(({ edge, direction, neighborId }) => (
                <li key={edge.id}>
                  <Tag>{label("relation", edge.type)}</Tag>{" "}
                  <span aria-hidden>{direction === "out" ? "→" : "←"}</span>{" "}
                  <button type="button" className="kn-toggle" onClick={() => focusNode(neighborId)} aria-label={tt("graph.follow", { label: nodeLabel(neighborId) })}>
                    {nodeLabel(neighborId)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );

  return (
    <div className="kn-stack">
      <div className="kn-toolbar">
        <div className="kn-actions" role="group" aria-label={tt("graph.viewMode")}>
          <Button type="button" variant={mode === "graph" ? "primary" : "secondary"} aria-pressed={mode === "graph"} onClick={() => setMode("graph")}>{tt("graph.modeGraph")}</Button>
          <Button type="button" variant={mode === "list" ? "primary" : "secondary"} aria-pressed={mode === "list"} onClick={() => setMode("list")}>{tt("graph.modeList")}</Button>
        </div>
        <p className="kn-muted" data-testid="graph-counts">{tt("graph.counts", { nodes: graph.nodes.length, edges: edges.length })}</p>
      </div>
      {graph.truncated ? <Notice tone="warning" title={tt("graph.truncatedTitle")}>{tt("graph.truncated")}</Notice> : null}

      <div className="kn-graph-controls">
        <div className="kn-field">
          <label htmlFor="kn-graph-search">{tt("graph.search")}</label>
          <input
            id="kn-graph-search"
            className="ui-input"
            type="search"
            value={query}
            placeholder={tt("graph.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && matches[0]) focusNode(matches[0].id); }}
          />
        </div>
        {query.trim() ? (
          <div data-testid="graph-matches">
            <p className="kn-muted">{matches.length === 0 ? tt("graph.noMatches") : tt("graph.matches", { count: matches.length })}</p>
            <ul className="kn-chips">
              {matches.slice(0, 8).map((node) => (
                <li key={node.id}><button type="button" className="kn-chip" onClick={() => focusNode(node.id)}>{node.label}</button></li>
              ))}
            </ul>
          </div>
        ) : null}
        <fieldset className="kn-fieldset">
          <legend>{tt("graph.filterTitle")}</legend>
          {typeCounts.length === 0 ? <p className="kn-muted">{tt("graph.noEdges")}</p> : null}
          {typeCounts.map(([type, count]) => (
            <label key={type} className="kn-check">
              <input type="checkbox" checked={!hidden.has(type)} onChange={() => toggleType(type)} />
              <span>{label("relation", type)} ({count})</span>
            </label>
          ))}
        </fieldset>
      </div>

      {mode === "graph" ? (
        <div className="kn-graph-layout">
          <div
            className="kn-graph"
            tabIndex={0}
            role="group"
            aria-label={tt("graph.canvasLabel")}
            aria-describedby="kn-graph-help"
            onKeyDown={onKeyDown}
          >
            <div className="kn-graph__tools">
              <Button type="button" variant="secondary" size="small" aria-label={tt("graph.zoomIn")} onClick={() => setView((v) => zoomAround(v, 1.2))}><Plus size={14} aria-hidden /></Button>
              <Button type="button" variant="secondary" size="small" aria-label={tt("graph.zoomOut")} onClick={() => setView((v) => zoomAround(v, 1 / 1.2))}><Minus size={14} aria-hidden /></Button>
              <Button type="button" variant="secondary" size="small" aria-label={tt("graph.reset")} onClick={() => setView(INITIAL_VIEW)}><RotateCcw size={14} aria-hidden /></Button>
              <span className="kn-muted" data-testid="graph-zoom">{Math.round(clampZoom(view.k) * 100)}%</span>
            </div>
            <svg
              ref={svgRef}
              className="kn-graph__svg"
              viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={tt("graph.svgLabel", { nodes: graph.nodes.length, edges: edges.length })}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
              onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}
            >
              <defs>
                <marker id="kn-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="kn-arrowhead" />
                </marker>
              </defs>
              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                {edges.map((edge: GraphEdge) => {
                  const a = byId.get(edge.from) as PlacedNode;
                  const b = byId.get(edge.to) as PlacedNode;
                  const related = selected !== null && (edge.from === selected || edge.to === selected);
                  return (
                    <g key={edge.id} data-edge-type={edge.type} data-testid="graph-edge" className={`kn-edge${related ? " is-related" : ""}${edge.type === "CONFLICTS_WITH" ? " is-conflict" : ""}${selected && !related ? " is-dim" : ""}`}>
                      <title>{`${a.label} ${label("relation", edge.type)} ${b.label}`}</title>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd="url(#kn-arrow)" />
                      {related ? <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} className="kn-edge__label" textAnchor="middle">{label("relation", edge.type)}</text> : null}
                    </g>
                  );
                })}
                {placed.map((node) => {
                  const isSel = node.id === selected;
                  const dim = selected !== null && !isSel && !neighborIds.has(node.id);
                  return (
                    <g
                      key={node.id}
                      data-testid="graph-node"
                      data-node-id={node.id}
                      data-selected={isSel ? "true" : undefined}
                      data-match={matchIds.has(node.id) ? "true" : undefined}
                      transform={`translate(${node.x} ${node.y})`}
                      className={`kn-node kn-node--${node.kind}${isSel ? " is-selected" : ""}${matchIds.has(node.id) ? " is-match" : ""}${dim ? " is-dim" : ""}`}
                      role="button"
                      tabIndex={tabStops ? 0 : -1}
                      aria-pressed={isSel}
                      aria-label={`${node.label} (${label("nodeKind", node.kind)})`}
                      onClick={(event) => { event.stopPropagation(); if (!drag.current?.moved) setSelected(node.id); }}
                      onKeyDown={selectKey(node.id)}
                    >
                      <title>{`${node.label} (${label("nodeKind", node.kind)})`}</title>
                      <Shape kind={node.kind} />
                      <text y={R + 14} textAnchor="middle" className="kn-node__label">{truncateLabel(node.label)}</text>
                    </g>
                  );
                })}
              </g>
            </svg>
            <p id="kn-graph-help" className="kn-muted">{tt("graph.keyboardHelp")}</p>
          </div>
          {inspector}
        </div>
      ) : (
        <div className="kn-stack" data-testid="graph-list">
          <div className="kn-table-wrap">
            <table className="kn-table">
              <caption>{tt("graph.nodesTable")}</caption>
              <thead><tr><th scope="col">{tt("graph.colLabel")}</th><th scope="col">{tt("graph.colKind")}</th><th scope="col">{tt("graph.colId")}</th><th scope="col">{tt("graph.colRelations")}</th><th scope="col">{tt("graph.colAction")}</th></tr></thead>
              <tbody>
                {placed.map((node) => (
                  <tr key={node.id}>
                    <td className="kn-cell-wrap">{node.label}</td><td>{label("nodeKind", node.kind)}</td><td className="kn-cell-wrap">{node.id}</td>
                    <td>{relationsOf(node.id, edges).length}</td>
                    <td><button type="button" className="kn-toggle" aria-label={tt("graph.inspectNode", { label: node.label })} onClick={() => setSelected(node.id)}>{tt("graph.inspect")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kn-table-wrap">
            <table className="kn-table">
              <caption>{tt("graph.edgesTable")}</caption>
              <thead><tr><th scope="col">{tt("graph.colFrom")}</th><th scope="col">{tt("graph.colRelation")}</th><th scope="col">{tt("graph.colTo")}</th><th scope="col">{tt("graph.colSource")}</th></tr></thead>
              <tbody>
                {edges.map((edge) => (
                  <tr key={edge.id}>
                    <td className="kn-cell-wrap">{nodeLabel(edge.from)}</td><td>{label("relation", edge.type)}</td><td className="kn-cell-wrap">{nodeLabel(edge.to)}</td><td>{edge.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {inspector}
        </div>
      )}

      <ul className="kn-legend" aria-label={tt("graph.legend")}>
        {GRAPH_NODE_KINDS.map((kind) => (
          <li key={kind}><LegendShape kind={kind} /> {label("nodeKind", kind)}</li>
        ))}
      </ul>
    </div>
  );
}
