import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useAuth } from "../../auth/useAuth";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "../Operations/OperationsPage.css";

const COLUMNS = ["queued", "running", "blocked", "awaiting_approval", "completed", "failed", "cancelled", "created"] as const;

interface TaskView {
  taskId: string;
  description: string;
  projectId: string;
  status: string;
  assignedAgentId?: string;
  failureReason?: string;
}
interface Handoff {
  id: string;
  taskId: string;
  sourceAgentId: string;
  destinationAgentId: string;
  status: string;
  createdAt: string;
}

/**
 * Agent Teams (UI Layer 15). A board over the orchestrator's REAL task
 * states and the specialist workforce's RECORDED handoffs. Nothing here
 * assigns or executes; columns are backend statuses, not UI inventions.
 */
export default function AgentTeamsPage() {
  const { t, language } = useI18n();
  const { accessToken } = useAuth();
  const tasks = useQuery({
    queryKey: ["teams", "tasks", accessToken ?? "anonymous"],
    queryFn: () => apiRequest<{ items: TaskView[] }>("/api/tasks?limit=200", { accessToken }),
    retry: false,
    refetchInterval: 30_000,
  });
  const handoffs = useQuery({
    queryKey: ["teams", "handoffs", accessToken ?? "anonymous"],
    queryFn: () => apiRequest<Handoff[]>("/api/workforce/handoffs", { accessToken }),
    retry: false,
  });
  const notComposed = handoffs.error instanceof ApiError && handoffs.error.status === 404;
  const byStatus = (s: string) => tasks.data?.items.filter((x) => x.status === s) ?? [];

  return (
    <PageContainer variant="wide">
      <PageHeader eyebrow={t("common.brand")} title={t("agentTeams.title")} description={t("agentTeams.description")} />
      <p className="ops-muted">{t("agentTeams.gaps")}</p>
      {tasks.error ? <p role="alert">{t("agentTeams.loadFailed")}</p> : null}
      {tasks.data && tasks.data.items.length === 0 ? <p className="ops-muted">{t("agentTeams.empty")}</p> : null}
      {tasks.data && tasks.data.items.length ? (
        <div className="ops-bento">
          {COLUMNS.filter((c) => byStatus(c).length).map((c) => (
            <section key={c} className="ops-card" aria-label={t(`agentTeams.statuses.${c}` as MessageKey)}>
              <h2>
                {t(`agentTeams.statuses.${c}` as MessageKey)} ({byStatus(c).length})
              </h2>
              <ul className="ops-list">
                {byStatus(c).slice(0, 30).map((task) => (
                  <li key={task.taskId}>
                    <Link to={`/tasks/${encodeURIComponent(task.taskId)}`}>{task.description.slice(0, 80) || task.taskId}</Link>
                    <div className="ops-muted">
                      {task.projectId}
                      {task.assignedAgentId ? ` · ${task.assignedAgentId}` : ""}
                      {task.failureReason ? ` · ${task.failureReason}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      <section className="ops-card" style={{ marginTop: 12 }}>
        <h2>{t("agentTeams.handoffs")}</h2>
        {notComposed ? <p className="ops-muted">{t("agentTeams.handoffsNotComposed")}</p> : null}
        {Array.isArray(handoffs.data) && handoffs.data.length === 0 ? <p className="ops-muted">{t("agentTeams.handoffsNone")}</p> : null}
        <ul className="ops-list">
          {(Array.isArray(handoffs.data) ? handoffs.data : []).slice(0, 50).map((h) => (
            <li key={h.id}>
              {h.sourceAgentId} → {h.destinationAgentId} · {h.status} · <Link to={`/tasks/${encodeURIComponent(h.taskId)}`}>{h.taskId}</Link> ·{" "}
              {formatDateTime(h.createdAt, language)}
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
