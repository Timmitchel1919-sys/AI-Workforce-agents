import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  CheckCircle2,
  Copy,
  Archive,
  Link2,
  Maximize,
  Play,
  Plus,
  Redo2,
  Save,
  ShieldCheck,
  Trash2,
  Undo2,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { useAuth } from "../../auth/useAuth";
import { ProjectPicker } from "../../features/projectScope/ProjectPicker";
import { useActiveProject } from "../../features/projectScope/useActiveProject";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import {
  getSimulation,
  studioErrorMessage,
  useStudioCatalog,
  useStudioCommand,
  useWorkflowDefinition,
  useWorkflowDefinitions,
  type Simulation,
  type StudioCatalog,
  type ValidationIssue,
  type WorkflowDefinition,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowVersion,
} from "../../features/workflowStudio/studioClient";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  addNode,
  autoLayout,
  bounds,
  clientValidate,
  commit,
  connect,
  diffGraphs,
  emptyGraph,
  historyOf,
  moveNodes,
  outlineOrder,
  redo,
  removeEdge,
  removeNodes,
  undo,
  updateNode,
  type History,
} from "../../features/workflowStudio/graphModel";
import "./WorkflowStudioPage.css";

type Panel = "validation" | "simulation" | "versions" | "outline";
type Lifecycle = "draft" | "validated" | "published" | "archived";

interface Notice {
  tone: "ok" | "error";
  text: string;
}

function lifecycleOf(def: WorkflowDefinition): Lifecycle {
  if (def.status === "archived") return "archived";
  if (def.status === "published") return "published";
  return def.lastValidation?.valid && def.lastValidation.draftRevision === def.draftRevision ? "validated" : "draft";
}

/**
 * Workflow Studio (UI Layer 4). Visual authoring over the Control Plane's
 * versioned workflow definitions. The canvas is a convenience; the server
 * validates, persists and versions every graph, and no workflow is executed
 * from here (live launch is reported as unavailable by the backend).
 */
export default function WorkflowStudioPage() {
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const active = useActiveProject();
  const projectId = active.projectId;
  const canAuthor = accessDetails.capabilities.includes("author_workflow");
  const canPublish = accessDetails.capabilities.includes("publish_workflow");

  const catalog = useStudioCatalog(projectId);
  const list = useWorkflowDefinitions(projectId);
  const [selectedDefId, setSelectedDefId] = useState<string | null>(null);
  const detail = useWorkflowDefinition(projectId, selectedDefId);
  const command = useStudioCommand(projectId);

  const [history, setHistory] = useState<History>(() => historyOf(emptyGraph()));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseline, setBaseline] = useState<string>("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<Panel>("validation");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [compareVersion, setCompareVersion] = useState<WorkflowVersion | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  const graph = history.present;
  const definition = selectedDefId ? detail.data?.definition : undefined;
  const versions = detail.data?.versions ?? [];
  const archived = definition?.status === "archived";
  const editable = canAuthor && !archived;
  const snapshot = JSON.stringify({ graph, name, description });
  const dirty = baseline !== "" && snapshot !== baseline;

  // Load a definition into the editor whenever the server copy changes.
  const loadedRevision = useRef<string>("");
  useEffect(() => {
    if (!definition) return;
    const key = `${definition.definitionId}@${definition.draftRevision}`;
    if (loadedRevision.current === key) return;
    loadedRevision.current = key;
    setHistory(historyOf(definition.draft));
    setName(definition.name);
    setDescription(definition.description);
    setBaseline(JSON.stringify({ graph: definition.draft, name: definition.name, description: definition.description }));
    setSelection(new Set());
    setSimulation(null);
  }, [definition]);

  // A brand-new draft starts from a minimal trigger → terminal graph.
  const startNew = useCallback(() => {
    if (dirty && !window.confirm(t("workflowStudio.unsavedConfirm"))) return;
    const fresh = emptyGraph();
    loadedRevision.current = "";
    setSelectedDefId(null);
    setHistory(historyOf(fresh));
    setName(t("workflowStudio.untitled"));
    setDescription("");
    setBaseline(JSON.stringify({ graph: fresh, name: "", description: "" }));
    setSelection(new Set());
    setSimulation(null);
  }, [dirty, t]);

  const open = (id: string) => {
    if (id === selectedDefId) return;
    if (dirty && !window.confirm(t("workflowStudio.unsavedConfirm"))) return;
    setSelectedDefId(id);
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const apply = (next: WorkflowGraph) => setHistory((h) => commit(h, next));

  const run = async (cmd: Parameters<typeof command.mutateAsync>[0], ok: (r: Awaited<ReturnType<typeof command.mutateAsync>>) => string) => {
    setNotice(null);
    try {
      const result = await command.mutateAsync(cmd);
      setNotice({ tone: "ok", text: ok(result) });
      return result;
    } catch (error) {
      setNotice({ tone: "error", text: studioErrorMessage(error) });
      return null;
    }
  };

  const save = async () => {
    const result = await run(
      {
        command: "save-workflow-draft",
        body: {
          ...(definition ? { definitionId: definition.definitionId, expectedRevision: definition.draftRevision } : {}),
          name: name.trim() || t("workflowStudio.untitled"),
          description,
          graph,
        },
      },
      (r) => t("workflowStudio.saved", { revision: r.details.draftRevision ?? "?" }),
    );
    if (result?.resourceId) setSelectedDefId(result.resourceId);
  };

  const publish = async () => {
    if (!definition || !window.confirm(t("workflowStudio.publishConfirm", { revision: definition.draftRevision }))) return;
    await run(
      { command: "publish-workflow", body: { definitionId: definition.definitionId, expectedRevision: definition.draftRevision } },
      (r) => t("workflowStudio.published", { version: r.details.version ?? "?" }),
    );
  };

  const simulate = async (source: "draft" | number) => {
    if (!projectId || !definition) return;
    setPanel("simulation");
    try {
      setSimulation(await getSimulation(projectId, definition.definitionId, source));
    } catch (error) {
      setNotice({ tone: "error", text: studioErrorMessage(error) });
    }
  };

  const hints = useMemo(() => clientValidate(graph, catalog.data), [graph, catalog.data]);

  if (active.loading) return <PageContainer variant="wide"><Skeleton height={320} /></PageContainer>;

  return (
    <PageContainer variant="wide">
      <PageHeader eyebrow={t("common.brand")} title={t("workflowStudio.title")} description={t("workflowStudio.description")} />

      <div className="ws-scope">
        <ProjectPicker projects={active.projects} value={projectId ?? ""} onChange={active.select} />
        <ModeStrip catalog={catalog.data} />
      </div>

      {!projectId ? <EmptyState title={t("workflowStudio.selectProject")} /> : null}
      {catalog.error ? <ErrorState title={studioErrorMessage(catalog.error)} onRetry={() => void catalog.refetch()} /> : null}

      {notice ? (
        <p className={`gov-notice gov-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      {projectId && catalog.data ? (
        <div className="ws-layout">
          <aside className="ws-side ws-side--left" aria-label={t("workflowStudio.library")}>
            <section>
              <div className="ws-side__head">
                <h2>{t("workflowStudio.library")}</h2>
                {canAuthor ? (
                  <button type="button" className="ui-button ghost ws-icon-btn" onClick={startNew} aria-label={t("workflowStudio.newWorkflow")} title={t("workflowStudio.newWorkflow")}>
                    <Plus size={16} aria-hidden />
                  </button>
                ) : null}
              </div>
              {list.isLoading ? <Skeleton height={80} /> : null}
              {list.error ? <p className="ws-muted" role="alert">{studioErrorMessage(list.error)}</p> : null}
              {list.data && list.data.items.length === 0 ? <p className="ws-muted">{t("workflowStudio.noWorkflows")}</p> : null}
              <ul className="ws-library">
                {list.data?.items.map((def) => (
                  <li key={def.definitionId}>
                    <button
                      type="button"
                      className={`ws-library__item${def.definitionId === selectedDefId ? " is-active" : ""}`}
                      aria-current={def.definitionId === selectedDefId ? "true" : undefined}
                      onClick={() => open(def.definitionId)}
                    >
                      <span className="ws-library__name">{def.name}</span>
                      <LifecycleBadge lifecycle={lifecycleOf(def)} version={def.latestPublishedVersion} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2>{t("workflowStudio.palette")}</h2>
              <ul className="ws-palette">
                {catalog.data.nodeKinds.map(({ kind, backing }) => (
                  <li key={kind}>
                    <button
                      type="button"
                      className="ws-palette__item"
                      disabled={!editable}
                      title={backing}
                      onClick={() => {
                        const { graph: next, id } = addNode(graph, kind, t(`workflowStudio.kinds.${kind}` as MessageKey));
                        apply(next);
                        setSelection(new Set([id]));
                      }}
                    >
                      <span className={`ws-dot ws-dot--${kind}`} aria-hidden />
                      {t("workflowStudio.actions.add", { kind: t(`workflowStudio.kinds.${kind}` as MessageKey) })}
                    </button>
                  </li>
                ))}
              </ul>
              <details className="ws-unavailable">
                <summary>{t("workflowStudio.unavailableKinds")}</summary>
                <ul>
                  {catalog.data.unavailableNodeKinds.map(({ kind, reason }) => (
                    <li key={kind}>
                      <strong>{t(`workflowStudio.kinds.${kind}` as MessageKey)}</strong>: {reason}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          </aside>

          <section className="ws-center">
            <div className="ws-toolbar" role="toolbar" aria-label={t("workflowStudio.title")}>
              <label className="ws-name">
                <span className="visually-hidden">{t("workflowStudio.name")}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={120} placeholder={t("workflowStudio.untitled")} />
              </label>
              {definition ? (
                <span className="ws-meta">
                  <LifecycleBadge lifecycle={lifecycleOf(definition)} version={definition.latestPublishedVersion} />
                  <span>{t("workflowStudio.revision", { revision: definition.draftRevision })}</span>
                </span>
              ) : null}
              {dirty ? <span className="ws-dirty" role="status">{t("workflowStudio.unsaved")}</span> : null}
              <span className="ws-toolbar__spacer" />
              <ToolButton icon={Undo2} label={t("workflowStudio.actions.undo")} disabled={!editable || !history.past.length} onClick={() => setHistory(undo)} />
              <ToolButton icon={Redo2} label={t("workflowStudio.actions.redo")} disabled={!editable || !history.future.length} onClick={() => setHistory(redo)} />
              <ToolButton icon={Wand2} label={t("workflowStudio.actions.arrange")} disabled={!editable} onClick={() => apply(autoLayout(graph))} />
              <ToolButton icon={Save} label={t("workflowStudio.actions.save")} disabled={!editable || command.isPending || (!dirty && Boolean(definition))} onClick={() => void save()} primary />
              <ToolButton
                icon={ShieldCheck}
                label={t("workflowStudio.actions.validate")}
                disabled={!canAuthor || !definition || dirty || command.isPending}
                onClick={() => void run({ command: "validate-workflow", body: { definitionId: definition!.definitionId } }, (r) => r.reason)}
              />
              <ToolButton icon={Play} label={t("workflowStudio.actions.simulate")} disabled={!definition || dirty} onClick={() => void simulate("draft")} />
              {canPublish ? (
                <ToolButton icon={Upload} label={t("workflowStudio.actions.publish")} disabled={!definition || dirty || archived || command.isPending} onClick={() => void publish()} />
              ) : null}
              {canAuthor && definition ? (
                <ToolButton
                  icon={Copy}
                  label={t("workflowStudio.actions.duplicate")}
                  disabled={command.isPending}
                  onClick={() =>
                    void run({ command: "duplicate-workflow", body: { definitionId: definition.definitionId } }, (r) => r.reason).then((r) => {
                      if (r?.resourceId) setSelectedDefId(r.resourceId);
                    })
                  }
                />
              ) : null}
              {canPublish && definition && !archived ? (
                <ToolButton
                  icon={Archive}
                  label={t("workflowStudio.actions.archive")}
                  disabled={command.isPending}
                  onClick={() => {
                    if (window.confirm(t("workflowStudio.archiveConfirm")))
                      void run({ command: "archive-workflow", body: { definitionId: definition.definitionId } }, (r) => r.reason);
                  }}
                />
              ) : null}
            </div>

            {!canAuthor ? <p className="ws-banner">{t("workflowStudio.readOnly")}</p> : null}
            {archived ? <p className="ws-banner">{t("workflowStudio.archivedReadOnly")}</p> : null}

            <Canvas
              graph={graph}
              editable={editable}
              selection={selection}
              setSelection={setSelection}
              connectFrom={connectFrom}
              setConnectFrom={setConnectFrom}
              issues={[...(definition?.lastValidation?.draftRevision === definition?.draftRevision && !dirty ? definition?.lastValidation?.issues ?? [] : []), ...hints]}
              simulation={simulation}
              onCommit={apply}
              onError={(text) => setNotice({ tone: "error", text })}
            />

            <BottomPanel
              panel={panel}
              setPanel={setPanel}
              definition={definition}
              dirty={dirty}
              hints={hints}
              graph={graph}
              simulation={simulation}
              versions={versions}
              compareVersion={compareVersion}
              setCompareVersion={setCompareVersion}
              canRestore={canAuthor}
              onSimulate={simulate}
              onRestore={(version) => {
                if (!definition || !window.confirm(t("workflowStudio.restoreConfirm", { version }))) return;
                void run({ command: "restore-workflow-version", body: { definitionId: definition.definitionId, version } }, (r) => r.reason);
              }}
              onSelectNode={(id) => setSelection(new Set([id]))}
            />
          </section>

          <aside className="ws-side ws-side--right" aria-label={t("workflowStudio.inspector.title")}>
            <h2>{t("workflowStudio.inspector.title")}</h2>
            <label className="ws-field">
              <span>{t("workflowStudio.workflowDescription")}</span>
              <textarea rows={2} value={description} disabled={!editable} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <Inspector
              graph={graph}
              selection={selection}
              catalog={catalog.data}
              editable={editable}
              onChange={apply}
              onSelect={(id) => setSelection(new Set([id]))}
              onError={(text) => setNotice({ tone: "error", text })}
            />
          </aside>
        </div>
      ) : null}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: typeof Save;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button type="button" className={`ui-button ${primary ? "primary" : "ghost"} ws-tool`} onClick={onClick} disabled={disabled} title={label}>
      <Icon size={16} aria-hidden />
      <span className="ws-tool__label">{label}</span>
    </button>
  );
}

function LifecycleBadge({ lifecycle, version }: { lifecycle: Lifecycle; version?: number }) {
  const { t } = useI18n();
  return (
    <span className={`ws-badge ws-badge--${lifecycle}`}>
      {t(`workflowStudio.lifecycle.${lifecycle}` as MessageKey)}
      {version ? ` · ${t("workflowStudio.version", { version })}` : ""}
    </span>
  );
}

function ModeStrip({ catalog }: { catalog?: StudioCatalog }) {
  const { t } = useI18n();
  return (
    <ul className="ws-modes" aria-label={t("workflowStudio.modes.label")}>
      <li className="is-on">{t("workflowStudio.modes.design")}</li>
      <li className="is-on">{t("workflowStudio.modes.validation")}</li>
      <li className="is-on">{t("workflowStudio.modes.simulation")}</li>
      <li className="is-off" title={catalog?.modes.dryRun.reason}>{t("workflowStudio.modes.dryRun")}</li>
      <li className="is-off" title={catalog?.modes.liveExecution.reason}>{t("workflowStudio.modes.live")}</li>
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

interface CanvasProps {
  graph: WorkflowGraph;
  editable: boolean;
  selection: Set<string>;
  setSelection: (s: Set<string>) => void;
  connectFrom: string | null;
  setConnectFrom: (id: string | null) => void;
  issues: ValidationIssue[];
  simulation: Simulation | null;
  onCommit: (g: WorkflowGraph) => void;
  onError: (text: string) => void;
}

function Canvas({ graph, editable, selection, setSelection, connectFrom, setConnectFrom, issues, simulation, onCommit, onError }: CanvasProps) {
  const { t } = useI18n();
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [drag, setDrag] = useState<{ kind: "pan" | "nodes"; startX: number; startY: number; dx: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fit = useCallback(() => {
    const el = svgRef.current;
    const b = bounds(graph);
    const width = el?.clientWidth || 800;
    const height = el?.clientHeight || 420;
    const scale = Math.max(0.3, Math.min(1.5, Math.min(width / b.width, height / b.height)));
    setView({ x: -b.x * scale + (width - b.width * scale) / 2, y: -b.y * scale + (height - b.height * scale) / 2, scale });
  }, [graph]);

  const nodeIssues = useMemo(() => {
    const m = new Set<string>();
    issues.forEach((i) => i.nodeId && i.severity === "error" && m.add(i.nodeId));
    return m;
  }, [issues]);
  const simOutcome = useMemo(() => new Map(simulation?.steps.map((s) => [s.nodeId, s.outcome]) ?? []), [simulation]);

  const zoom = (factor: number) => setView((v) => ({ ...v, scale: Math.max(0.3, Math.min(2.5, v.scale * factor)) }));

  const pointerDownBg = (e: PointerEvent<SVGRectElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ kind: "pan", startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 });
    if (!e.shiftKey) setSelection(new Set());
    setConnectFrom(null);
  };

  const pointerDownNode = (e: PointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation();
    if (connectFrom) {
      const result = connect(graph, connectFrom, id);
      if (result.ok) onCommit(result.graph);
      else onError(t(`workflowStudio.connectErrors.${result.reason}` as MessageKey));
      setConnectFrom(null);
      return;
    }
    const next = new Set(e.shiftKey ? selection : selection.has(id) ? selection : []);
    if (e.shiftKey && next.has(id)) next.delete(id);
    else next.add(id);
    setSelection(next);
    if (editable) {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setDrag({ kind: "nodes", startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 });
    }
  };

  const pointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.kind === "pan") {
      setView((v) => ({ ...v, x: v.x + dx - drag.dx, y: v.y + dy - drag.dy }));
    }
    setDrag({ ...drag, dx, dy });
  };

  const pointerUp = () => {
    if (drag?.kind === "nodes" && (Math.abs(drag.dx) > 2 || Math.abs(drag.dy) > 2)) {
      onCommit(moveNodes(graph, selection, drag.dx / view.scale, drag.dy / view.scale));
    }
    setDrag(null);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "Escape") {
      setConnectFrom(null);
      setSelection(new Set());
      return;
    }
    if (!editable || selection.size === 0) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onCommit(removeNodes(graph, selection));
      setSelection(new Set());
      return;
    }
    const step = e.shiftKey ? 40 : 10;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (delta[e.key]) {
      e.preventDefault();
      onCommit(moveNodes(graph, selection, delta[e.key]![0], delta[e.key]![1]));
    }
  };

  const offset = (id: string) =>
    drag?.kind === "nodes" && selection.has(id) ? { x: drag.dx / view.scale, y: drag.dy / view.scale } : { x: 0, y: 0 };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <div className="ws-canvas">
      <div className="ws-canvas__controls">
        <button type="button" className="ui-button ghost ws-icon-btn" onClick={() => zoom(1.2)} aria-label={t("workflowStudio.actions.zoomIn")} title={t("workflowStudio.actions.zoomIn")}><ZoomIn size={16} aria-hidden /></button>
        <button type="button" className="ui-button ghost ws-icon-btn" onClick={() => zoom(1 / 1.2)} aria-label={t("workflowStudio.actions.zoomOut")} title={t("workflowStudio.actions.zoomOut")}><ZoomOut size={16} aria-hidden /></button>
        <button type="button" className="ui-button ghost ws-icon-btn" onClick={fit} aria-label={t("workflowStudio.actions.fit")} title={t("workflowStudio.actions.fit")}><Maximize size={16} aria-hidden /></button>
        {editable && selection.size > 0 ? (
          <button
            type="button"
            className="ui-button ghost ws-icon-btn"
            onClick={() => {
              onCommit(removeNodes(graph, selection));
              setSelection(new Set());
            }}
            aria-label={t("workflowStudio.actions.delete")}
            title={t("workflowStudio.actions.delete")}
          >
            <Trash2 size={16} aria-hidden />
          </button>
        ) : null}
      </div>
      {connectFrom ? <p className="ws-canvas__hint" role="status">{t("workflowStudio.canvas.connectHint")}</p> : null}
      {graph.nodes.length === 0 ? <p className="ws-canvas__hint">{t("workflowStudio.canvas.empty")}</p> : null}
      <svg
        ref={svgRef}
        className="ws-canvas__svg"
        role="application"
        aria-label={t("workflowStudio.canvas.label")}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
      >
        <defs>
          <marker id="ws-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="ws-arrow" />
          </marker>
        </defs>
        <rect className="ws-canvas__bg" width="100%" height="100%" onPointerDown={pointerDownBg} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {graph.edges.map((edge) => {
            const a = byId.get(edge.from);
            const b = byId.get(edge.to);
            if (!a || !b) return null;
            const oa = offset(a.id);
            const ob = offset(b.id);
            const x1 = a.position.x + oa.x + NODE_WIDTH;
            const y1 = a.position.y + oa.y + NODE_HEIGHT / 2;
            const x2 = b.position.x + ob.x;
            const y2 = b.position.y + ob.y + NODE_HEIGHT / 2;
            const mid = Math.max(40, (x2 - x1) / 2);
            return (
              <path
                key={edge.id}
                className="ws-edge"
                d={`M${x1},${y1} C${x1 + mid},${y1} ${x2 - mid},${y2} ${x2},${y2}`}
                markerEnd="url(#ws-arrow)"
              />
            );
          })}
          {graph.nodes.map((node) => {
            const o = offset(node.id);
            const outcome = simOutcome.get(node.id);
            const classes = [
              "ws-node",
              `ws-node--${node.kind}`,
              selection.has(node.id) ? "is-selected" : "",
              nodeIssues.has(node.id) ? "has-issue" : "",
              outcome ? `sim-${outcome}` : "",
              connectFrom === node.id ? "is-source" : "",
            ].join(" ");
            return (
              <g
                key={node.id}
                className={classes}
                transform={`translate(${node.position.x + o.x} ${node.position.y + o.y})`}
                onPointerDown={(e) => pointerDownNode(e, node.id)}
                role="button"
                aria-label={`${t(`workflowStudio.kinds.${node.kind}` as MessageKey)}: ${node.label}`}
                aria-pressed={selection.has(node.id)}
              >
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={12} />
                <text x={14} y={24} className="ws-node__kind">{t(`workflowStudio.kinds.${node.kind}` as MessageKey)}</text>
                <text x={14} y={46} className="ws-node__label">{node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}</text>
                {nodeIssues.has(node.id) ? <text x={NODE_WIDTH - 22} y={24} className="ws-node__warn" aria-hidden>!</text> : null}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inspector                                                           */
/* ------------------------------------------------------------------ */

function Inspector({
  graph,
  selection,
  catalog,
  editable,
  onChange,
  onSelect,
  onError,
}: {
  graph: WorkflowGraph;
  selection: Set<string>;
  catalog: StudioCatalog;
  editable: boolean;
  onChange: (g: WorkflowGraph) => void;
  onSelect: (id: string) => void;
  onError: (text: string) => void;
}) {
  const { t } = useI18n();
  if (selection.size === 0) return <p className="ws-muted">{t("workflowStudio.inspector.none")}</p>;
  if (selection.size > 1) return <p className="ws-muted">{t("workflowStudio.inspector.multiple", { count: selection.size })}</p>;
  const node = graph.nodes.find((n) => selection.has(n.id));
  if (!node) return null;
  const set = (patch: Partial<WorkflowNode>) => onChange(updateNode(graph, node.id, patch));
  const setConfig = (patch: Partial<WorkflowNode["config"]>) => set({ config: { ...node.config, ...patch } });
  const capabilities = [...new Set(catalog.agents.flatMap((a) => a.capabilities))].sort();
  const taskTypes = [...new Set(catalog.agents.flatMap((a) => a.supportedTaskTypes))].sort();
  const outgoing = graph.edges.filter((e) => e.from === node.id);
  const targets = graph.nodes.filter((n) => n.id !== node.id && !outgoing.some((e) => e.to === n.id));
  const backing = catalog.nodeKinds.find((k) => k.kind === node.kind)?.backing;

  return (
    <div className="ws-inspector">
      <p className="ws-muted">
        <span className={`ws-dot ws-dot--${node.kind}`} aria-hidden /> {t(`workflowStudio.kinds.${node.kind}` as MessageKey)} · <code>{node.id}</code>
      </p>
      {backing ? <p className="ws-muted">{t("workflowStudio.inspector.backing")}: {backing}</p> : null}
      <label className="ws-field">
        <span>{t("workflowStudio.inspector.label")}</span>
        <input value={node.label} maxLength={120} disabled={!editable} onChange={(e) => set({ label: e.target.value })} />
      </label>
      <label className="ws-field">
        <span>{t("workflowStudio.inspector.description")}</span>
        <textarea rows={2} value={node.description ?? ""} maxLength={1000} disabled={!editable} onChange={(e) => set({ description: e.target.value })} />
      </label>

      {node.kind === "agent_task" ? (
        <>
          <label className="ws-field">
            <span>{t("workflowStudio.inspector.taskType")}</span>
            <input list="ws-task-types" value={node.config.taskType ?? ""} disabled={!editable} maxLength={200} onChange={(e) => setConfig({ taskType: e.target.value || undefined })} />
            <datalist id="ws-task-types">{taskTypes.map((x) => <option key={x} value={x} />)}</datalist>
          </label>
          <label className="ws-field">
            <span>{t("workflowStudio.inspector.agent")}</span>
            <select value={node.config.agentId ?? ""} disabled={!editable} onChange={(e) => setConfig({ agentId: e.target.value || undefined })}>
              <option value="">{t("workflowStudio.inspector.anyAgent")}</option>
              {catalog.agents.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {a.name}
                  {a.usableOnProject ? "" : ` (${t("workflowStudio.inspector.agentUnusable")})`}
                </option>
              ))}
            </select>
          </label>
          <label className="ws-field">
            <span>{t("workflowStudio.inspector.capability")}</span>
            <select value={node.config.capability ?? ""} disabled={!editable} onChange={(e) => setConfig({ capability: e.target.value || undefined })}>
              <option value="">{t("workflowStudio.inspector.noCapability")}</option>
              {capabilities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <fieldset className="ws-field">
            <legend>{t("workflowStudio.inspector.tools")}</legend>
            {catalog.tools.length === 0 ? <p className="ws-muted">{t("workflowStudio.inspector.noTools")}</p> : null}
            {catalog.tools.map((tool) => (
              <label key={tool.toolId} className="ws-check">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={node.config.expectedTools?.includes(tool.toolId) ?? false}
                  onChange={(e) => {
                    const current = new Set(node.config.expectedTools ?? []);
                    if (e.target.checked) current.add(tool.toolId);
                    else current.delete(tool.toolId);
                    setConfig({ expectedTools: current.size ? [...current] : undefined });
                  }}
                />
                {tool.name}
              </label>
            ))}
          </fieldset>
          <label className="ws-field">
            <span>{t("workflowStudio.inspector.criteria")}</span>
            <textarea
              rows={3}
              disabled={!editable}
              value={(node.config.acceptanceCriteria ?? []).join("\n")}
              onChange={(e) => {
                const lines = e.target.value.split("\n").map((l) => l.trimStart()).slice(0, 20);
                setConfig({ acceptanceCriteria: lines.some((l) => l.trim()) ? lines : undefined });
              }}
            />
          </label>
        </>
      ) : null}

      {node.kind === "approval" ? (
        <label className="ws-field">
          <span>{t("workflowStudio.inspector.approvalAction")}</span>
          <input value={node.config.approvalAction ?? ""} maxLength={200} disabled={!editable} onChange={(e) => setConfig({ approvalAction: e.target.value || undefined })} />
        </label>
      ) : null}

      <p className="ws-hint">{t("workflowStudio.inspector.noCredentials")}</p>

      {node.kind !== "terminal" ? (
        <fieldset className="ws-field">
          <legend>{t("workflowStudio.inspector.outgoing")}</legend>
          <ul className="ws-edges">
            {outgoing.map((e) => {
              const target = graph.nodes.find((n) => n.id === e.to);
              return (
                <li key={e.id}>
                  <button type="button" className="ws-link" onClick={() => onSelect(e.to)}>
                    <Link2 size={14} aria-hidden /> {target?.label ?? e.to}
                  </button>
                  {editable ? (
                    <button
                      type="button"
                      className="ui-button ghost ws-icon-btn"
                      aria-label={t("workflowStudio.inspector.removeEdge", { target: target?.label ?? e.to })}
                      title={t("workflowStudio.inspector.removeEdge", { target: target?.label ?? e.to })}
                      onClick={() => onChange(removeEdge(graph, e.id))}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {editable && targets.length ? (
            <select
              aria-label={t("workflowStudio.inspector.connectTo")}
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const result = connect(graph, node.id, e.target.value);
                if (result.ok) onChange(result.graph);
                else onError(t(`workflowStudio.connectErrors.${result.reason}` as MessageKey));
              }}
            >
              <option value="">{t("workflowStudio.inspector.connectTo")}</option>
              {targets.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom panel                                                        */
/* ------------------------------------------------------------------ */

function BottomPanel(props: {
  panel: Panel;
  setPanel: (p: Panel) => void;
  definition?: WorkflowDefinition;
  dirty: boolean;
  hints: ValidationIssue[];
  graph: WorkflowGraph;
  simulation: Simulation | null;
  versions: WorkflowVersion[];
  compareVersion: WorkflowVersion | null;
  setCompareVersion: (v: WorkflowVersion | null) => void;
  canRestore: boolean;
  onSimulate: (source: "draft" | number) => void;
  onRestore: (version: number) => void;
  onSelectNode: (id: string) => void;
}) {
  const { t, language } = useI18n();
  const { panel, setPanel, definition, graph } = props;
  const tabs: Panel[] = ["validation", "simulation", "versions", "outline"];
  const issueLabel = (i: ValidationIssue) => t(`workflowStudio.issues.${i.code}` as MessageKey);
  const label = (id?: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <section className="ws-bottom">
      <div role="tablist" className="ws-tabs">
        {tabs.map((p) => (
          <button key={p} type="button" role="tab" id={`ws-tab-${p}`} aria-selected={panel === p} aria-controls={`ws-panel-${p}`} className={panel === p ? "is-active" : ""} onClick={() => setPanel(p)}>
            {t(`workflowStudio.panels.${p}` as MessageKey)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`ws-panel-${panel}`} aria-labelledby={`ws-tab-${panel}`} className="ws-panel">
        {panel === "validation" ? (
          <>
            <p>
              {!definition?.lastValidation
                ? t("workflowStudio.validation.never")
                : definition.lastValidation.draftRevision !== definition.draftRevision || props.dirty
                  ? t("workflowStudio.validation.stale", { revision: definition.lastValidation.draftRevision })
                  : definition.lastValidation.valid
                    ? t("workflowStudio.validation.serverValid", { revision: definition.lastValidation.draftRevision })
                    : t("workflowStudio.validation.serverInvalid", { count: definition.lastValidation.issues.length, revision: definition.lastValidation.draftRevision })}
            </p>
            {definition?.lastValidation && !props.dirty ? (
              <IssueList issues={definition.lastValidation.issues} label={issueLabel} nodeLabel={label} onSelect={props.onSelectNode} />
            ) : null}
            <h3>{t("workflowStudio.validation.clientHints")}</h3>
            {props.hints.length === 0 ? <p className="ws-muted">{t("workflowStudio.validation.none")}</p> : <IssueList issues={props.hints} label={issueLabel} nodeLabel={label} onSelect={props.onSelectNode} />}
          </>
        ) : null}

        {panel === "simulation" ? (
          <>
            <div className="ws-row">
              <button type="button" className="ui-button ghost" disabled={!definition || props.dirty} onClick={() => props.onSimulate("draft")}>
                <Play size={14} aria-hidden /> {t("workflowStudio.simulation.runDraft")}
              </button>
              {props.versions.slice(0, 3).map((v) => (
                <button key={v.version} type="button" className="ui-button ghost" onClick={() => props.onSimulate(v.version)}>
                  {t("workflowStudio.simulation.runVersion", { version: v.version })}
                </button>
              ))}
            </div>
            {!props.simulation ? <p className="ws-muted">{t("workflowStudio.simulation.none")}</p> : (
              <>
                <p className="ws-sim-note" role="status"><CheckCircle2 size={14} aria-hidden /> {t("workflowStudio.simulation.sideEffectFree")}</p>
                {!props.simulation.valid ? <p role="alert">{t("workflowStudio.simulation.blockedInvalid")}</p> : null}
                <ol className="ws-steps">
                  {props.simulation.steps.map((s) => (
                    <li key={s.nodeId} className={`ws-step ws-step--${s.outcome}`}>
                      <strong>{t(`workflowStudio.simulation.outcomes.${s.outcome}` as MessageKey)}</strong> · {label(s.nodeId)}
                      {s.resolvedAgentId ? ` · ${t("workflowStudio.simulation.agent", { agent: s.resolvedAgentId })}` : ""}
                    </li>
                  ))}
                </ol>
                {!props.simulation.valid ? <IssueList issues={props.simulation.issues} label={issueLabel} nodeLabel={label} onSelect={props.onSelectNode} /> : null}
              </>
            )}
          </>
        ) : null}

        {panel === "versions" ? (
          props.versions.length === 0 ? <p className="ws-muted">{t("workflowStudio.versions.none")}</p> : (
            <ul className="ws-versions">
              {props.versions.map((v) => {
                const diff = props.compareVersion?.version === v.version ? diffGraphs(v.graph, graph) : null;
                return (
                  <li key={v.version}>
                    <div className="ws-row">
                      <strong>{t("workflowStudio.version", { version: v.version })}</strong>
                      <span className="ws-muted">{t("workflowStudio.versions.publishedBy", { date: formatDateTime(v.publishedAt, language) ?? v.publishedAt, actor: v.publishedBy })}</span>
                      <code title={t("workflowStudio.versions.hash")}>{v.graphHash.slice(0, 12)}</code>
                      <button type="button" className="ui-button ghost" onClick={() => props.setCompareVersion(diff ? null : v)}>{t("workflowStudio.actions.compare")}</button>
                      {props.canRestore ? (
                        <button type="button" className="ui-button ghost" onClick={() => props.onRestore(v.version)}>{t("workflowStudio.actions.restore")}</button>
                      ) : null}
                    </div>
                    {diff ? (
                      <p className="ws-muted">
                        {t("workflowStudio.versions.diff", {
                          added: diff.added.length,
                          removed: diff.removed.length,
                          changed: diff.changed.length,
                          edgesAdded: diff.edgesAdded,
                          edgesRemoved: diff.edgesRemoved,
                        })}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {panel === "outline" ? (
          <>
            <p className="ws-muted">{t("workflowStudio.outline.intro")}</p>
            <ol className="ws-outline">
              {outlineOrder(graph).map((n) => {
                const next = graph.edges.filter((e) => e.from === n.id).map((e) => label(e.to));
                return (
                  <li key={n.id}>
                    <button type="button" className="ws-link" onClick={() => props.onSelectNode(n.id)}>
                      {t(`workflowStudio.kinds.${n.kind}` as MessageKey)}: {n.label}
                    </button>{" "}
                    {next.length ? `${t("workflowStudio.outline.leadsTo")} ${next.join(", ")}` : t("workflowStudio.outline.end")}
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
      </div>
    </section>
  );
}

function IssueList({
  issues,
  label,
  nodeLabel,
  onSelect,
}: {
  issues: ValidationIssue[];
  label: (i: ValidationIssue) => string;
  nodeLabel: (id?: string) => string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="ws-issues">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`} className={`ws-issue ws-issue--${issue.severity}`}>
          <strong>{label(issue)}</strong>
          {issue.nodeId ? (
            <>
              {" · "}
              <button type="button" className="ws-link" onClick={() => onSelect(issue.nodeId!)}>{nodeLabel(issue.nodeId)}</button>
            </>
          ) : null}
          {issue.message ? <span className="ws-muted"> · {issue.message}</span> : null}
        </li>
      ))}
    </ul>
  );
}

