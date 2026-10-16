import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { Skeleton } from "../../components/ui";
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useAuth } from "../../auth/useAuth";
import { getAuditEvents, type AuditFilter, type AuditItem } from "../../features/governance/governanceClient";
import { getExecutionEnvironments } from "../../features/operations/operationsClient";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "./OperationsPage.css";

type HealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";

interface Snapshot {
  generatedAt: string;
  status: { counts: Record<string, number> };
  health: { status: HealthStatus; components: { name: string; status: HealthStatus; detail: string }[] };
  agents: { agentId: string; name: string; status: string; enabled: boolean; stats?: { failed: number; completed: number } }[];
  approvals: { approvalId: string; status: string }[];
  recentAudit: AuditItem[];
}

const COUNT_KEYS = [
  "activeWorkflows",
  "runningTasks",
  "queuedTasks",
  "blockedTasks",
  "failedTasks",
  "awaitingApproval",
  "registeredAgents",
  "disabledAgents",
] as const;

/**
 * Operations Center (UI Layer 8). A read surface over the Control Plane's
 * existing dashboard snapshot, runner status and audit log — no telemetry of
 * its own. A value the server does not report is shown as unknown, never 0.
 */
export default function OperationsPage() {
  const { t, language } = useI18n();
  const { accessToken } = useAuth();
  const snapshot = useQuery({
    queryKey: ["ops", "dashboard", accessToken ?? "anonymous"],
    queryFn: () => apiRequest<Snapshot>("/api/dashboard", { accessToken }),
    retry: false,
    refetchInterval: 30_000,
  });
  const runners = useQuery({
    queryKey: ["ops", "runners", accessToken ?? "anonymous"],
    queryFn: () => getExecutionEnvironments(accessToken),
    retry: false,
  });
  const data = snapshot.data;
  const forbidden = snapshot.error instanceof ApiError && (snapshot.error.status === 401 || snapshot.error.status === 403);
  const pending = data?.approvals.filter((a) => a.status === "pending").length;
  const failures = data?.recentAudit.filter((e) => e.outcome === "failed" || e.outcome === "denied" || e.outcome === "rejected") ?? [];
  const realRunners = runners.data?.families.filter((f) => f.realRunners > 0) ?? [];

  return (
    <PageContainer variant="wide">
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("opsCenter.title")}
        description={t("opsCenter.description")}
        actions={
          <button type="button" className="ui-button ghost" onClick={() => void snapshot.refetch()}>
            <RefreshCw size={16} aria-hidden /> {t("opsCenter.refresh")}
          </button>
        }
      />
      {snapshot.isLoading ? <Skeleton height={200} /> : null}
      {snapshot.error ? <p role="alert">{forbidden ? t("opsCenter.forbidden") : t("opsCenter.loadFailed")}</p> : null}

      {data ? (
        <>
          <p className="ops-muted">{t("opsCenter.generatedAt", { time: formatDateTime(data.generatedAt, language) ?? data.generatedAt })}</p>
          <div className="ops-bento">
            <section className="ops-card ops-card--wide" aria-labelledby="ops-health">
              <h2 id="ops-health">{t("opsCenter.health.title")}</h2>
              <ul className="ops-health">
                {data.health.components.map((c) => (
                  <li key={c.name} className={`ops-status ops-status--${c.status}`}>
                    <strong>{c.name}</strong>
                    <span>{t(`opsCenter.health.statuses.${c.status}` as MessageKey)}</span>
                    <span className="ops-muted">{c.detail}</span>
                  </li>
                ))}
              </ul>
              <p className="ops-muted">{t("opsCenter.health.note")}</p>
            </section>

            <section className="ops-card" aria-labelledby="ops-counts">
              <h2 id="ops-counts">{t("opsCenter.counts.title")}</h2>
              <dl className="ops-counts">
                {COUNT_KEYS.map((k) => (
                  <div key={k}>
                    <dt>{t(`opsCenter.counts.${k}` as MessageKey)}</dt>
                    <dd>{typeof data.status.counts[k] === "number" ? data.status.counts[k] : t("opsCenter.unknown")}</dd>
                  </div>
                ))}
              </dl>
              <Link to="/workflows">→ /workflows</Link>
            </section>

            <section className="ops-card" aria-labelledby="ops-approvals">
              <h2 id="ops-approvals">{t("opsCenter.approvals.title")}</h2>
              <p className="ops-big">{pending === undefined ? t("opsCenter.unknown") : t("opsCenter.approvals.pending", { count: pending })}</p>
              <Link to="/approvals">{t("opsCenter.approvals.open")}</Link>
            </section>

            <section className="ops-card" aria-labelledby="ops-runners">
              <h2 id="ops-runners">{t("opsCenter.runners.title")}</h2>
              {runners.error ? <p className="ops-muted">{t("opsCenter.notConnected")}</p> : null}
              {runners.data && realRunners.length === 0 ? <p className="ops-muted">{t("opsCenter.runners.none")}</p> : null}
              <ul className="ops-list">
                {realRunners.map((f) => (
                  <li key={f.family}>
                    {f.family} · {f.status} · {t("opsCenter.runners.real", { count: f.realRunners })}
                  </li>
                ))}
              </ul>
            </section>

            <section className="ops-card" aria-labelledby="ops-agents">
              <h2 id="ops-agents">{t("opsCenter.agents.title")}</h2>
              {data.agents.length === 0 ? <p className="ops-muted">{t("opsCenter.agents.empty")}</p> : null}
              <ul className="ops-list">
                {data.agents.slice(0, 8).map((a) => (
                  <li key={a.agentId}>
                    <Link to={`/agents/${encodeURIComponent(a.agentId)}`}>{a.name}</Link> · {a.status}
                  </li>
                ))}
              </ul>
              <p className="ops-muted">{t("opsCenter.agents.idleNote")}</p>
            </section>

            <section className="ops-card" aria-labelledby="ops-failures">
              <h2 id="ops-failures">{t("opsCenter.failures.title")}</h2>
              {failures.length === 0 ? <p className="ops-muted">{t("opsCenter.failures.none")}</p> : null}
              <ul className="ops-list">
                {failures.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <span className="ops-mono">{e.type}</span> · {e.outcome} · {formatDateTime(e.timestamp, language)}
                  </li>
                ))}
              </ul>
            </section>

            <section className="ops-card" aria-labelledby="ops-incidents">
              <h2 id="ops-incidents">{t("opsCenter.incidents.title")}</h2>
              <p className="ops-muted">{t("opsCenter.incidents.note")}</p>
              <Link to="/itsm">{t("opsCenter.incidents.open")}</Link>
            </section>
          </div>
        </>
      ) : null}

      <LogExplorer />
    </PageContainer>
  );
}

function LogExplorer() {
  const { t, language } = useI18n();
  const { accessToken } = useAuth();
  const [draft, setDraft] = useState<AuditFilter>({});
  const [filter, setFilter] = useState<AuditFilter>({});
  const logs = useInfiniteQuery({
    queryKey: ["ops", "audit", filter, accessToken ?? "anonymous"],
    queryFn: ({ pageParam }) => getAuditEvents(filter, pageParam, accessToken),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = logs.data?.pages.flatMap((p) => p.items) ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFilter({ ...draft });
  };
  const field = (key: keyof AuditFilter, label: MessageKey) => (
    <label className="ops-field">
      <span>{t(label)}</span>
      <input value={draft[key] ?? ""} maxLength={128} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );

  return (
    <section className="ops-card ops-logs" aria-labelledby="ops-logs">
      <h2 id="ops-logs">{t("opsCenter.logs.title")}</h2>
      <p className="ops-muted">{t("opsCenter.logs.intro")}</p>
      <form className="ops-filters" onSubmit={submit}>
        {field("type", "opsCenter.logs.type")}
        {field("outcome", "opsCenter.logs.outcome")}
        {field("projectId", "opsCenter.logs.project")}
        {field("correlationId", "opsCenter.logs.correlation")}
        <button type="submit" className="ui-button primary">{t("opsCenter.logs.search")}</button>
      </form>
      {logs.error ? <p role="alert">{t("opsCenter.loadFailed")}</p> : null}
      {logs.data && items.length === 0 ? <p className="ops-muted">{t("opsCenter.logs.empty")}</p> : null}
      {items.length ? (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                {(["time", "type", "actor", "project", "outcome", "correlation"] as const).map((c) => (
                  <th key={c} scope="col">{t(`opsCenter.logs.columns.${c}` as MessageKey)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.timestamp, language)}</td>
                  <td className="ops-mono">{e.type}</td>
                  <td>{e.actor ?? "—"}</td>
                  <td>{e.projectId ?? "—"}</td>
                  <td>{e.outcome ?? "—"}</td>
                  <td className="ops-mono">{e.correlationId?.slice(0, 12) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {logs.hasNextPage ? (
        <button type="button" className="ui-button ghost" onClick={() => void logs.fetchNextPage()}>{t("opsCenter.logs.more")}</button>
      ) : null}
    </section>
  );
}
