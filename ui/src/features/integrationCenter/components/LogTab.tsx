import { useState, type FormEvent } from "react";
import { Button, Select } from "../../../components/ui";
import type { ProjectOption } from "../../projectScope/projectScope";
import { useActivity, useAudit, useCanManage, useHealth, useIntegrationCommand, useOverview } from "../hooks/useIntegrations";
import { useT } from "../lib/useT";
import { ACTIVITY_OUTCOMES, type ActivityFilters } from "../types";
import { McpSection } from "./McpSection";
import { Empty, ErrorPanel, OutcomeTag, Readable, RiskTag, Skeleton, StatusTag, Tag } from "./common";
import { useReport } from "./report";

const NO_FILTERS: ActivityFilters = { connectorId: "", outcome: "" };

function Activity({ projectId, projects }: { projectId: string | undefined; projects: readonly ProjectOption[] }) {
  const { tt, label, formatTime } = useT();
  const [draft, setDraft] = useState<ActivityFilters>(NO_FILTERS);
  const [applied, setApplied] = useState<ActivityFilters>(NO_FILTERS);
  const query = useActivity(applied, projectId);
  const overview = useOverview(projectId);
  const connectors = overview.data?.connectors ?? [];
  const project = (id: string) => projects.find((p) => p.projectId === id)?.displayName || id;
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setApplied(draft);
  };
  return (
    <section className="ic-panel" aria-labelledby="ic-activity-title">
      <h2 id="ic-activity-title" className="ic-panel__title">{tt("log.activityTitle")}</h2>
      <p className="ic-muted">{tt("log.activityExplained")}</p>
      <form className="ic-form" onSubmit={apply} aria-label={tt("log.activityTitle")}>
        <div className="ic-filters">
          <Select label={tt("log.connectorFilter")} value={draft.connectorId} onChange={(e) => setDraft((d) => ({ ...d, connectorId: e.target.value }))}>
            <option value="">{tt("common.any")}</option>
            {connectors.map((c) => <option key={c.connectorId} value={c.connectorId}>{c.name}</option>)}
          </Select>
          <Select label={tt("log.outcomeFilter")} value={draft.outcome} onChange={(e) => setDraft((d) => ({ ...d, outcome: e.target.value }))}>
            <option value="">{tt("common.any")}</option>
            {ACTIVITY_OUTCOMES.map((o) => <option key={o} value={o}>{tt(`outcome.${o}`)}</option>)}
          </Select>
        </div>
        <div className="ic-actions">
          <Button type="submit" variant="primary">{tt("common.apply")}</Button>
          <Button type="button" onClick={() => { setDraft(NO_FILTERS); setApplied(NO_FILTERS); }}>{tt("common.reset")}</Button>
        </div>
      </form>
      {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        query.data.length === 0 ? <Empty title={tt("log.noActivity")} body={tt("log.noActivityBody")} /> : (
          <div className="ic-table-wrap">
            <table className="ic-table" data-testid="activity-table">
              <caption className="ic-visually-hidden">{tt("log.activityTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{tt("log.time")}</th>
                  <th scope="col">{tt("log.capability")}</th>
                  <th scope="col">{tt("log.connector")}</th>
                  <th scope="col">{tt("log.project")}</th>
                  <th scope="col">{tt("log.agent")}</th>
                  <th scope="col">{tt("log.outcome")}</th>
                  <th scope="col">{tt("log.duration")}</th>
                  <th scope="col">{tt("log.errorKind")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((a) => (
                  <tr key={a.id} data-activity-id={a.id}>
                    <td>{formatTime(a.at)}</td>
                    <td className="ic-cell-wrap"><span className="ic-inline-code">{a.capability}</span></td>
                    <td className="ic-cell-wrap">{a.provider ?? a.connectorId ?? tt("common.none")}</td>
                    <td className="ic-cell-wrap">{project(a.projectId)}</td>
                    <td className="ic-cell-wrap">{a.agentId ?? tt("log.system")}</td>
                    <td><OutcomeTag value={a.outcome} /></td>
                    <td>{a.durationMs !== undefined ? tt("log.ms", { ms: a.durationMs }) : tt("common.none")}</td>
                    <td className="ic-cell-wrap">{a.errorKind ?? tt("common.none")}{a.operation ? <span className="ic-muted"> ({label("operation", a.operation)})</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}

function Audit({ projectId }: { projectId: string | undefined }) {
  const { tt, formatTime } = useT();
  const query = useAudit(projectId);
  return (
    <section className="ic-panel" aria-labelledby="ic-audit-title">
      <h2 id="ic-audit-title" className="ic-panel__title">{tt("log.auditTitle")}</h2>
      <p className="ic-muted">{tt("log.auditExplained")}</p>
      {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        query.data.length === 0 ? <Empty title={tt("log.noAudit")} body={tt("log.noAuditBody")} /> : (
          <div className="ic-table-wrap">
            <table className="ic-table" data-testid="audit-table">
              <caption className="ic-visually-hidden">{tt("log.auditTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{tt("log.auditTime")}</th>
                  <th scope="col">{tt("log.operation")}</th>
                  <th scope="col">{tt("log.actor")}</th>
                  <th scope="col">{tt("log.resource")}</th>
                  <th scope="col">{tt("log.risk")}</th>
                  <th scope="col">{tt("log.result")}</th>
                  <th scope="col">{tt("log.detail")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((e) => (
                  <tr key={e.seq} data-seq={e.seq}>
                    <td>{formatTime(e.at)}</td>
                    <td className="ic-cell-wrap"><span className="ic-inline-code">{e.operation}</span></td>
                    <td className="ic-cell-wrap">{e.agentId ?? e.actor}</td>
                    <td className="ic-cell-wrap">{e.resource ?? e.toolId ?? tt("common.none")}</td>
                    <td>{e.risk ? <RiskTag value={e.risk} /> : tt("common.none")}</td>
                    <td className="ic-cell-wrap">{e.result}</td>
                    <td className="ic-cell-wrap"><Readable value={e.detail} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}

function Queue() {
  const { tt, label, formatTime } = useT();
  const manage = useCanManage();
  const { report } = useReport();
  const query = useHealth();
  const drain = useIntegrationCommand();
  return (
    <section className="ic-panel" aria-labelledby="ic-queue-title">
      <h2 id="ic-queue-title" className="ic-panel__title">{tt("log.queueTitle")}</h2>
      <p className="ic-muted">{tt("log.queueExplained")}</p>
      <div className="ic-actions">
        <Button
          type="button" variant="primary" loading={drain.isPending} disabled={!manage}
          title={manage ? undefined : tt("common.needsManage")}
          onClick={() => drain.mutate(
            { command: "integration_drain_queue", body: {} },
            {
              onSuccess: () => report({ tone: "success", message: tt("log.drained") }),
              onError: (error: unknown) => report({ tone: "danger", title: tt("report.failedTitle"), message: error instanceof Error ? error.message : String(error) }),
            },
          )}
        >
          {tt("log.drain")}
        </Button>
      </div>
      {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        <>
          {query.data.queue.length === 0 ? <Empty title={tt("log.noQueue")} /> : (
            <ul className="ic-rows" data-testid="queue-list">
              {query.data.queue.map((q) => (
                <li key={q.id} className="ic-row" data-queue-id={q.id}>
                  <div className="ic-row__head"><span className="ic-row__title ic-inline-code">{q.capability}</span><Tag tone={q.status === "QUEUED" ? "info" : "neutral"}>{q.status}</Tag></div>
                  <div className="ic-row__meta">
                    <span className="ic-muted">{q.connectorId}</span>
                    <span className="ic-muted">{tt("log.attempts")}: {q.attempts}</span>
                    {q.nextAttemptAt ? <span className="ic-muted">{tt("log.nextAttempt")}: {formatTime(q.nextAttemptAt)}</span> : null}
                  </div>
                  {q.lastError ? <p className="ic-text">{tt("log.lastError")}: {q.lastError}</p> : null}
                </li>
              ))}
            </ul>
          )}
          <div className="ic-sub">
            <h3 className="ic-sub__title">{tt("log.healthTitle")}</h3>
            <ul className="ic-list" data-testid="health-list">
              {query.data.connectors.map((c) => (
                <li key={c.connectorId}>
                  <strong>{c.name}</strong> <StatusTag status={c.status} /> <span className="ic-muted">{label("mode", c.mode)}</span>
                  {c.health.lastError ? <span className="ic-muted"> {tt("card.lastError", { message: c.health.lastError.message })}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function LogTab({ projectId, projects }: { projectId: string | undefined; projects: readonly ProjectOption[] }) {
  return (
    <div className="ic-stack">
      <Activity projectId={projectId} projects={projects} />
      <Audit projectId={projectId} />
      <Queue />
      <McpSection projects={projects} />
    </div>
  );
}
