import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, GitBranch, Lock, Play, Plus, Workflow } from "lucide-react";
import { Dialog, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../auth/useAuth";
import {
  useSoftwareFactoryCommand,
  useSoftwareFactoryProgram,
  type GraphNode,
  type GraphProjection,
  type SoftwareFactoryTaskView,
  type SoftwareFactoryUiState,
  type TaskEnvironmentRoutingSummary,
  type TaskStatus,
  type Workstream,
} from "../../features/softwareFactory";
import { formatDateTime, translateStatus, useI18n, type MessageKey } from "../../i18n";
import "../Approvals/ApprovalsPage.css";
import "../Infrastructure/InfrastructurePage.css";
import {
  DAG_NODE_HEIGHT,
  DAG_NODE_WIDTH,
  layoutGraph,
  type DagEdgeLayout,
  type DagNodeLayout,
} from "./dagLayout";
import { commandLabel } from "./feedback";
import "./SoftwareFactoryPage.css";

interface Notice {
  tone: "ok" | "error";
  text: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function truncateId(id: string, max = 24): string {
  return id.length <= max ? id : `${id.slice(0, max - 1)}…`;
}

/**
 * Software Factory → one program: workstreams with their tasks, the task
 * dependency graph (dependency-free SVG layout of the backend projection),
 * per-task environment routing verdicts and the governed dispatch command.
 * Nothing here executes outside the Control Plane.
 */
export default function SoftwareFactoryProgramPage() {
  const { projectId, programId } = useParams<{ projectId: string; programId: string }>();
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const { status, program: detail, refetch } = useSoftwareFactoryProgram(projectId, programId);
  const canAddTask = accessDetails.capabilities.includes("add_task_to_workstream");
  const canCreateWorkstream = accessDetails.capabilities.includes("create_workstream");
  const canDispatch = accessDetails.capabilities.includes("tick_software_factory");
  const [creatingWs, setCreatingWs] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const tick = useSoftwareFactoryCommand(projectId, programId);
  const dispatch = () => {
    setNotice(null);
    tick.mutate(
      { kind: "tick", request: { projectId: projectId ?? "", programId: programId ?? "" } },
      {
        onSuccess: () => setNotice({ tone: "ok", text: t("softwareFactory.dispatchedNotice") }),
        onError: (error) => setNotice({ tone: "error", text: commandLabel(t, error) }),
      },
    );
  };

  if (status !== "ready" || !detail) {
    return (
      <PageContainer>
        <PageHeader eyebrow={t("softwareFactory.title")} title={t("softwareFactory.title")} />
        <ProgramState status={status} onRetry={() => void refetch()} backLabel={t("softwareFactory.backToFactory")} />
      </PageContainer>
    );
  }

  const { program, workstreams, graph, routes } = detail;

  return (
    <PageContainer>
      <PageHeader eyebrow={t("softwareFactory.title")} title={program.name} description={program.objective} />

      <div className="sf-actions">
        <Link to="/software-factory" className="ui-button">
          <ArrowLeft size={16} aria-hidden /> {t("softwareFactory.backToFactory")}
        </Link>
        {canAddTask && workstreams.length > 0 ? (
          <button type="button" className="ui-button" onClick={() => setAddingTask(true)}>
            <Plus size={16} aria-hidden /> {t("softwareFactory.addTask")}
          </button>
        ) : null}
        {canCreateWorkstream ? (
          <button type="button" className="ui-button" onClick={() => setCreatingWs(true)}>
            <Workflow size={16} aria-hidden /> {t("softwareFactory.createWorkstream")}
          </button>
        ) : null}
        {canDispatch ? (
          <button
            type="button"
            className="ui-button primary"
            onClick={dispatch}
            disabled={tick.isPending}
            aria-busy={tick.isPending}
          >
            <Play size={16} aria-hidden /> {tick.isPending ? t("softwareFactory.working") : t("softwareFactory.dispatch")}
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className={`gov-notice gov-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      <div className="sf-detail">
        <DagSection graph={graph} />
        <WorkstreamsSection workstreams={workstreams} nodes={graph.nodes} routes={routes} />
        <RoutingSection routes={routes} nodes={graph.nodes} />
      </div>

      {creatingWs ? (
        <CreateWorkstreamDialog
          projectId={program.projectId}
          programId={program.id}
          onClose={() => setCreatingWs(false)}
          onCreated={() => {
            setCreatingWs(false);
            setNotice({ tone: "ok", text: t("softwareFactory.workstreamCreated") });
          }}
        />
      ) : null}
      {addingTask ? (
        <AddTaskDialog
          projectId={program.projectId}
          programId={program.id}
          workstreams={workstreams}
          onClose={() => setAddingTask(false)}
          onCreated={() => {
            setAddingTask(false);
            setNotice({ tone: "ok", text: t("softwareFactory.taskCreated") });
          }}
        />
      ) : null}
    </PageContainer>
  );
}

function ProgramState({
  status,
  onRetry,
  backLabel,
}: {
  status: SoftwareFactoryUiState;
  onRetry: () => void;
  backLabel: string;
}) {
  const { t } = useI18n();
  if (status === "loading") {
    return (
      <div className="gov-list" role="status" aria-label={t("softwareFactory.loading")}>
        <Skeleton height={120} width="100%" />
        <Skeleton height={240} width="100%" />
      </div>
    );
  }
  if (status === "unauthenticated" || status === "forbidden") {
    return (
      <ErrorState
        icon={<Lock size={28} />}
        title={t(status === "forbidden" ? "softwareFactory.forbiddenTitle" : "softwareFactory.unauthenticatedTitle")}
        description={t(
          status === "forbidden" ? "softwareFactory.forbiddenDescription" : "softwareFactory.unauthenticatedDescription",
        )}
        secondaryAction={<Link to="/software-factory" className="ui-button">{backLabel}</Link>}
      />
    );
  }
  return (
    <ErrorState
      title={status === "not_found" ? t("softwareFactory.programNotFoundTitle") : t("softwareFactory.errorTitle")}
      description={
        status === "not_found" ? t("softwareFactory.programNotFoundDescription") : t("softwareFactory.errorDescription")
      }
      onRetry={onRetry}
      retryLabel={t("common.retry")}
      secondaryAction={<Link to="/software-factory" className="ui-button">{backLabel}</Link>}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Task graph                                                          */
/* ------------------------------------------------------------------ */

function edgePath(edge: DagEdgeLayout): string {
  const dx = (edge.toX - edge.fromX) / 2;
  return `M ${edge.fromX} ${edge.fromY} C ${edge.fromX + dx} ${edge.fromY}, ${edge.toX - dx} ${edge.toY}, ${edge.toX} ${edge.toY}`;
}

function DagSection({ graph }: { graph: GraphProjection }) {
  const { t } = useI18n();
  if (graph.nodes.length === 0) {
    return (
      <section className="infra-section" aria-labelledby="sf-graph-title">
        <header className="infra-section__header">
          <h2 id="sf-graph-title" className="infra-section__title">{t("softwareFactory.graphTitle")}</h2>
          <p className="gov-muted">{t("softwareFactory.graphDescription")}</p>
        </header>
        <EmptyState title={t("softwareFactory.graphEmpty")} />
      </section>
    );
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const layout = layoutGraph(graph.nodes, graph.edges);

  return (
    <section className="infra-section" aria-labelledby="sf-graph-title">
      <header className="infra-section__header">
        <h2 id="sf-graph-title" className="infra-section__title">{t("softwareFactory.graphTitle")}</h2>
        <p className="gov-muted">{t("softwareFactory.graphDescription")}</p>
      </header>
      <div className="sf-dag-wrap">
        <svg
          className="sf-dag"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          role="img"
          aria-label={t("softwareFactory.graphTitle")}
        >
          <defs>
            <marker id="sf-dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" className="sf-dag__arrow" />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            <path
              key={`${edge.from}:${edge.to}`}
              d={edgePath(edge)}
              className="sf-dag__edge"
              markerEnd="url(#sf-dag-arrow)"
            />
          ))}
          {layout.nodes.map((node) => {
            const task = nodeById.get(node.id);
            return <DagNode key={node.id} node={node} task={task?.task} status={task?.status ?? "created"} />;
          })}
        </svg>
      </div>
    </section>
  );
}

function DagNode({
  node,
  task,
  status,
}: {
  node: DagNodeLayout;
  task: SoftwareFactoryTaskView | undefined;
  status: TaskStatus;
}) {
  const { t } = useI18n();
  return (
    <g transform={`translate(${node.x}, ${node.y})`} className={`sf-dag-node sf-dag-node--${status}`}>
      {task?.description ? <title>{task.description}</title> : null}
      <rect width={DAG_NODE_WIDTH} height={DAG_NODE_HEIGHT} rx={10} className="sf-dag-node__frame" />
      <rect width={4} height={DAG_NODE_HEIGHT} rx={2} className="sf-dag-node__stripe" />
      <text x={16} y={24} className="sf-dag-node__id">
        {truncateId(node.id)}
      </text>
      <circle cx={16} cy={44} r={4} className="sf-dag-node__dot" />
      <text x={28} y={48} className="sf-dag-node__status">
        {translateStatus(t, status)}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Workstreams                                                         */
/* ------------------------------------------------------------------ */

function taskTone(status: TaskStatus): "positive" | "warning" | "negative" | "neutral" {
  if (status === "completed") return "positive";
  if (status === "failed" || status === "cancelled") return "negative";
  if (status === "blocked" || status === "awaiting_approval") return "warning";
  return "neutral";
}

function routeTone(status: TaskEnvironmentRoutingSummary["status"]): "positive" | "warning" | "negative" | "neutral" {
  if (status === "routed") return "positive";
  if (status === "requires_provisioning") return "warning";
  if (status === "skipped") return "neutral";
  return "negative";
}

function RouteBadge({ route }: { route: TaskEnvironmentRoutingSummary }) {
  const { t } = useI18n();
  return (
    <span className={`gov-pill gov-pill--${routeTone(route.status)} sf-route-badge`} title={route.detail}>
      <code>{route.code}</code> {t(`softwareFactory.routeStatus.${route.status}` as MessageKey)}
    </span>
  );
}

function WorkstreamsSection({
  workstreams,
  nodes,
  routes,
}: {
  workstreams: readonly Workstream[];
  nodes: readonly GraphNode[];
  routes: readonly TaskEnvironmentRoutingSummary[];
}) {
  const { t, language } = useI18n();
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const routeByTaskId = useMemo(() => new Map(routes.map((r) => [r.taskId, r])), [routes]);

  return (
    <section className="infra-section" aria-labelledby="sf-workstreams-title">
      <header className="infra-section__header">
        <h2 id="sf-workstreams-title" className="infra-section__title">{t("softwareFactory.workstreamTitle")}</h2>
        <p className="gov-muted">{t("softwareFactory.workstreamDescription")}</p>
      </header>
      {workstreams.length === 0 ? (
        <EmptyState title={t("softwareFactory.noWorkstreams")} />
      ) : (
        <ul className="gov-list">
          {workstreams.map((ws) => (
            <li key={ws.id} className="gov-card sf-ws-card">
              <div className="gov-card__head">
                <GitBranch size={16} aria-hidden />
                <strong className="infra-card__title">{ws.name}</strong>
                <span className={`gov-pill gov-pill--${ws.status === "active" ? "positive" : "neutral"}`}>
                  {translateStatus(t, ws.status)}
                </span>
              </div>
              <p className="infra-card__description">{ws.objective}</p>
              <p className="gov-muted">
                {t("softwareFactory.updated", { time: formatDateTime(ws.updatedAt, language) ?? ws.updatedAt })}
              </p>
              {ws.tasks.length === 0 ? (
                <p className="gov-muted">{t("softwareFactory.noTasksInWorkstream")}</p>
              ) : (
                <ul className="sf-task-list">
                  {ws.tasks.map((taskId) => {
                    const node = nodeById.get(taskId);
                    const route = routeByTaskId.get(taskId);
                    if (!node) return <li key={taskId} className="gov-muted">{taskId}</li>;
                    return (
                      <li key={taskId} className="sf-task-row">
                        <span className={`gov-pill gov-pill--${taskTone(node.status)}`}>{translateStatus(t, node.status)}</span>
                        <span className="sf-task-row__desc">
                          {node.task.description || node.id}
                          {node.task.dependencies && node.task.dependencies.length > 0 ? (
                            <small className="gov-muted">
                              {" "}· {t("softwareFactory.dependencies", { ids: node.task.dependencies.join(", ") })}
                            </small>
                          ) : null}
                        </span>
                        {route ? <RouteBadge route={route} /> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Environment routing                                                 */
/* ------------------------------------------------------------------ */

function RoutingSection({
  routes,
  nodes,
}: {
  routes: readonly TaskEnvironmentRoutingSummary[];
  nodes: readonly GraphNode[];
}) {
  const { t } = useI18n();
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  if (routes.length === 0) {
    return (
      <section className="infra-section" aria-labelledby="sf-routing-title">
        <header className="infra-section__header">
          <h2 id="sf-routing-title" className="infra-section__title">{t("softwareFactory.environmentRouting")}</h2>
        </header>
        <EmptyState title={t("softwareFactory.noRoutes")} />
      </section>
    );
  }
  return (
    <section className="infra-section" aria-labelledby="sf-routing-title">
      <header className="infra-section__header">
        <h2 id="sf-routing-title" className="infra-section__title">{t("softwareFactory.environmentRouting")}</h2>
        <p className="gov-muted">{t("softwareFactory.environmentRoutingDescription")}</p>
      </header>
      <ul className="gov-list">
        {routes.map((route) => (
          <li key={route.taskId} className="gov-card gov-audit__row sf-route-row">
            <span className="gov-action">{nodeById.get(route.taskId)?.task.description ?? route.taskId}</span>
            <RouteBadge route={route} />
            <span className="gov-muted">{route.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Create workstream                                                   */
/* ------------------------------------------------------------------ */

function CreateWorkstreamDialog({
  projectId,
  programId,
  onClose,
  onCreated,
}: {
  projectId: string;
  programId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const mutation = useSoftwareFactoryCommand(projectId, programId);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid = ID_PATTERN.test(id) && name.trim().length > 0 && objective.trim().length > 0;

  const submit = () => {
    if (!valid) {
      setError(t("softwareFactory.formIncomplete"));
      return;
    }
    mutation.mutate(
      {
        kind: "create-workstream",
        request: { projectId, programId, id: id.trim(), name: name.trim(), objective: objective.trim() },
      },
      {
        onSuccess: onCreated,
        onError: (e) => setError(commandLabel(t, e)),
      },
    );
  };

  return (
    <Dialog open onClose={onClose} title={t("softwareFactory.createWorkstream")} description={t("softwareFactory.createWorkstreamHint")}>
      <form
        className="gov-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="gov-field">
          <span>{t("softwareFactory.fieldId")}</span>
          <input value={id} onChange={(e) => setId(e.target.value.toLowerCase())} pattern="[a-z0-9][a-z0-9_-]{0,63}" required />
          <small className="gov-muted">{t("softwareFactory.fieldIdHint")}</small>
        </label>
        <label className="gov-field">
          <span>{t("softwareFactory.fieldName")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required />
        </label>
        <label className="gov-field">
          <span>{t("softwareFactory.fieldObjective")}</span>
          <textarea value={objective} onChange={(e) => setObjective(e.target.value)} maxLength={2000} rows={3} required />
        </label>

        {error ? (
          <p className="plan-warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("softwareFactory.cancel")}
          </button>
          <button type="submit" className="ui-button primary" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            <Plus size={16} aria-hidden /> {mutation.isPending ? t("softwareFactory.working") : t("softwareFactory.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Add task                                                            */
/* ------------------------------------------------------------------ */

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function AddTaskDialog({
  projectId,
  programId,
  workstreams,
  onClose,
  onCreated,
}: {
  projectId: string;
  programId: string;
  workstreams: readonly Workstream[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const mutation = useSoftwareFactoryCommand(projectId, programId);
  const [workstreamId, setWorkstreamId] = useState(workstreams[0]?.id ?? "");
  const [taskType, setTaskType] = useState("build");
  const [description, setDescription] = useState("");
  const [dependencies, setDependencies] = useState("");
  const [environmentRequirements, setEnvironmentRequirements] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid =
    Boolean(workstreamId) && taskType.trim().length > 0 && description.trim().length > 0;

  const submit = () => {
    if (!valid) {
      setError(t("softwareFactory.formIncomplete"));
      return;
    }
    mutation.mutate(
      {
        kind: "add-workstream-task",
        request: {
          projectId,
          programId,
          workstreamId,
          task: {
            type: taskType.trim(),
            description: description.trim(),
            dependencies: splitList(dependencies),
            environmentRequirements: splitList(environmentRequirements),
          },
        },
      },
      {
        onSuccess: onCreated,
        onError: (e) => setError(commandLabel(t, e)),
      },
    );
  };

  return (
    <Dialog open onClose={onClose} title={t("softwareFactory.addTask")} description={t("softwareFactory.addTaskHint")}>
      <form
        className="gov-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="gov-field">
          <span>{t("softwareFactory.fieldWorkstream")}</span>
          <select value={workstreamId} onChange={(e) => setWorkstreamId(e.target.value)} required>
            {workstreams.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>
        </label>
        <div className="sf-form-grid">
          <label className="gov-field">
            <span>{t("softwareFactory.fieldTaskType")}</span>
            <input value={taskType} onChange={(e) => setTaskType(e.target.value)} maxLength={80} required />
          </label>
        </div>
        <label className="gov-field">
          <span>{t("softwareFactory.fieldTaskDescription")}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} required />
        </label>
        <label className="gov-field">
          <span>{t("softwareFactory.taskDependencies")}</span>
          <input
            value={dependencies}
            onChange={(e) => setDependencies(e.target.value)}
            placeholder="t-2, t-3"
            aria-describedby="sf-deps-hint"
          />
          <small id="sf-deps-hint" className="gov-muted">
            {t("softwareFactory.taskDependenciesHint")}
          </small>
        </label>
        <label className="gov-field">
          <span>{t("softwareFactory.taskEnvironment")}</span>
          <input
            value={environmentRequirements}
            onChange={(e) => setEnvironmentRequirements(e.target.value)}
            placeholder="docker"
            aria-describedby="sf-env-hint"
          />
          <small id="sf-env-hint" className="gov-muted">
            {t("softwareFactory.taskEnvironmentHint")}
          </small>
        </label>

        {error ? (
          <p className="plan-warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("softwareFactory.cancel")}
          </button>
          <button type="submit" className="ui-button primary" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            <Plus size={16} aria-hidden />
            {mutation.isPending ? t("softwareFactory.working") : t("softwareFactory.add")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}