/**
 * EO-4.7 Execution Control Center — project Operations tab.
 *
 * Authoritative only: every number, state and row comes from the Control
 * Plane. A subsystem that is not configured says so; an empty list shows an
 * empty state. Nothing is estimated, simulated or synthesized in the UI.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CircleDashed, Lock, RefreshCw, ServerCog, XCircle } from "lucide-react";
import { Button, EmptyState, ErrorState, Skeleton } from "../../../components/ui";
import {
  useExecutionEnvironments,
  useExecutionOverview,
  useExecutionSessions,
  useProjectReleases,
  useProjectVerifications,
  type OperationsState,
  type SessionStatus,
} from "../../../features/operations";
import { formatDateTime, useI18n } from "../../../i18n";
import { SourceControlAndReleases } from "./SourceControlAndReleases";
import { environmentStatusLabel, sessionStatusLabel, shortId, stageStatusLabel, tone } from "./labels";
import "./Operations.css";

const STATUSES: SessionStatus[] = ["created", "validating", "ready", "running", "cancelling", "cancelled", "succeeded", "failed", "timed_out", "denied"];
const PAGE = 25;

export function StatusText({ value, label }: { value: string; label: string }) {
  const t = tone(value);
  const Icon = t === "ok" ? CheckCircle2 : t === "bad" ? XCircle : t === "warn" ? AlertTriangle : CircleDashed;
  return (
    <span className={`ops-status ops-status--${t}`}>
      <Icon size={14} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function StateGate({ state, onRetry, children }: { state: OperationsState; onRetry: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  if (state === "loading") {
    return (
      <div role="status" aria-label={t("operations.loading")}>
        <Skeleton height={64} width="100%" />
      </div>
    );
  }
  if (state === "forbidden" || state === "unauthenticated") {
    return <ErrorState icon={<Lock size={24} />} title={t("operations.errorTitle")} description={t("operations.forbidden")} />;
  }
  if (state === "not_found") return <ErrorState title={t("operations.errorTitle")} description={t("operations.notFound")} />;
  if (state !== "ready") {
    return <ErrorState title={t("operations.errorTitle")} description={t("operations.errorDescription")} onRetry={onRetry} retryLabel={t("common.retry")} />;
  }
  return <>{children}</>;
}

export function OperationsTab({ projectId }: { projectId: string }) {
  const { t, language } = useI18n();
  const [status, setStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const overview = useExecutionOverview(projectId);
  const environments = useExecutionEnvironments();
  const sessions = useExecutionSessions(projectId, { ...(status ? { status } : {}), offset, limit: PAGE });
  const verifications = useProjectVerifications(projectId);
  const releases = useProjectReleases(projectId);
  const base = `/projects/${encodeURIComponent(projectId)}/operations`;
  const refreshAll = () => {
    overview.refetch();
    environments.refetch();
    sessions.refetch();
    verifications.refetch();
    releases.refetch();
  };

  return (
    <div className="ops">
      <div className="ops-toolbar">
        <p className="plan-muted">{t("operations.description")}</p>
        <Button variant="secondary" onClick={refreshAll}>
          <RefreshCw size={16} aria-hidden /> {t("operations.refresh")}
        </Button>
      </div>

      <section className="plan-section" aria-labelledby="ops-overview">
        <h3 id="ops-overview">{t("operations.overviewTitle")}</h3>
        <StateGate state={overview.state} onRetry={overview.refetch}>
          {overview.data ? (
            <dl className="plan-metrics">
              <div className="plan-metric">
                <dt>{t("operations.sessionsTotal")}</dt>
                <dd>{overview.data.sessions.total}</dd>
              </div>
              {Object.entries(overview.data.sessions.byStatus).map(([key, count]) => (
                <div className="plan-metric" key={key}>
                  <dt>{sessionStatusLabel(t, key)}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
              <div className="plan-metric">
                <dt>{t("operations.awaitingApproval")}</dt>
                <dd>{overview.data.sessions.awaitingApproval}</dd>
              </div>
              <div className="plan-metric">
                <dt>{t("operations.verificationsTitle")}</dt>
                <dd>{overview.data.verifications.configured ? overview.data.verifications.total : t("operations.notConfigured")}</dd>
              </div>
              <div className="plan-metric">
                <dt>{t("operations.deployTitle")}</dt>
                <dd>{overview.data.releases.configured ? overview.data.releases.total : t("operations.notConfigured")}</dd>
              </div>
            </dl>
          ) : null}
        </StateGate>
      </section>

      <section className="plan-section" aria-labelledby="ops-environments">
        <h3 id="ops-environments">
          <ServerCog size={18} aria-hidden /> {t("operations.environmentsTitle")}
        </h3>
        <StateGate state={environments.state} onRetry={environments.refetch}>
          {!environments.data || environments.data.families.length === 0 ? (
            <p className="plan-muted">{t("operations.envEmpty")}</p>
          ) : (
            <ul className="ops-env-grid">
              {environments.data.families.map((f) => (
                <li key={f.family} className="ops-card">
                  <strong className="ops-family">{f.family}</strong>
                  <StatusText value={f.status} label={environmentStatusLabel(t, f.status)} />
                  <span className="plan-muted">{t("operations.runners", { real: f.realRunners, simulated: f.simulatedRunners })}</span>
                </li>
              ))}
            </ul>
          )}
        </StateGate>
      </section>

      <section className="plan-section" aria-labelledby="ops-sessions">
        <div className="ops-section-head">
          <h3 id="ops-sessions">{t("operations.sessionsTitle")}</h3>
          <label className="ops-filter">
            <span>{t("operations.statusFilter")}</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">{t("operations.allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {sessionStatusLabel(t, s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <StateGate state={sessions.state} onRetry={sessions.refetch}>
          {!sessions.data || sessions.data.items.length === 0 ? (
            <EmptyState title={t("operations.sessionsEmpty")} />
          ) : (
            <>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("operations.colSession")}</th>
                      <th scope="col">{t("operations.colStage")}</th>
                      <th scope="col">{t("operations.colStatus")}</th>
                      <th scope="col">{t("operations.colAgent")}</th>
                      <th scope="col">{t("operations.colEnvironment")}</th>
                      <th scope="col">{t("operations.colRunner")}</th>
                      <th scope="col">{t("operations.colCreated")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.data.items.map((s) => (
                      <tr key={s.sessionId}>
                        <td>
                          <Link to={`${base}/${encodeURIComponent(s.sessionId)}`}>
                            <code>{shortId(s.sessionId, 14)}</code>
                          </Link>
                        </td>
                        <td>
                          <code>{s.stageId}</code>
                        </td>
                        <td>
                          <StatusText value={s.status} label={sessionStatusLabel(t, s.status)} />
                        </td>
                        <td>{s.agentId}</td>
                        <td>{s.environmentInstanceId}</td>
                        <td>{s.runner ? <code>{s.runner.providerId}</code> : <span className="plan-muted">—</span>}</td>
                        <td>{formatDateTime(s.createdAt, language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ops-pager">
                <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                  {t("operations.previous")}
                </Button>
                <span className="plan-muted">
                  {t("operations.pageOf", { from: offset + 1, to: offset + sessions.data.items.length, total: sessions.data.total })}
                </span>
                <Button variant="secondary" disabled={offset + PAGE >= sessions.data.total} onClick={() => setOffset(offset + PAGE)}>
                  {t("operations.next")}
                </Button>
              </div>
            </>
          )}
        </StateGate>
      </section>

      <section className="plan-section" aria-labelledby="ops-verifications">
        <h3 id="ops-verifications">{t("operations.verificationsTitle")}</h3>
        <StateGate state={verifications.state} onRetry={verifications.refetch}>
          {!verifications.data?.configured ? (
            <p className="plan-muted">{t("operations.notConfigured")}</p>
          ) : verifications.data.items.length === 0 ? (
            <p className="plan-muted">{t("operations.verificationEmpty")}</p>
          ) : (
            <ul className="plan-rows">
              {verifications.data.items.map((v) => (
                <li key={v.verificationId} className="plan-row plan-row--stacked">
                  <span>
                    <code>{shortId(v.verificationId, 14)}</code> · <StatusText value={v.status} label={stageStatusLabel(t, v.status)} />
                  </span>
                  {v.status === "passed" && v.sourceCurrent === false ? (
                    <p className="ops-warning" role="status">
                      <AlertTriangle size={14} aria-hidden /> {t("operations.reverificationRequired")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </StateGate>
      </section>

      <StateGate state={releases.state} onRetry={releases.refetch}>
        {releases.data ? <SourceControlAndReleases data={releases.data} /> : null}
      </StateGate>
    </div>
  );
}
