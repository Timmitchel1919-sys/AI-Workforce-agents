import { useState } from "react";
import { Link } from "react-router-dom";
import { Pin } from "lucide-react";
import { Button, Select } from "../../../components/ui";
import { useAlert, useAlerts, useCanManage } from "../hooks/useTrust";
import { isClosed, splitAlerts } from "../lib/logic";
import { useT } from "../lib/useT";
import { ALERT_SEVERITIES, ALERT_STATUSES, type Alert, type AlertStatus, type SecurityCommandName } from "../types";
import { CommandDialog } from "./CommandDialog";
import { DefList, Empty, ErrorPanel, Readable, RiskTag, Skeleton, Tag } from "./common";

interface Transition { status: Exclude<AlertStatus, "OPEN">; noteRequired: boolean }
const TRANSITIONS: Transition[] = [
  { status: "ACKNOWLEDGED", noteRequired: false },
  { status: "INVESTIGATING", noteRequired: false },
  { status: "RESOLVED", noteRequired: true },
  { status: "FALSE_POSITIVE", noteRequired: true },
];
const COMMAND: SecurityCommandName = "security_alert_transition";

function AlertStatusTag({ status }: { status: string }) {
  const { label } = useT();
  return <Tag tone={isClosed(status) ? "neutral" : status === "OPEN" ? "warning" : "info"}>{label("alertStatus", status)}</Tag>;
}

/** Lifecycle actions. HIGH/CRITICAL closing is admin-only on the server; its refusal text is shown in the dialog. */
function LifecycleActions({ alert }: { alert: Alert }) {
  const { tt, label } = useT();
  const canManage = useCanManage();
  const [pending, setPending] = useState<Transition | null>(null);
  if (!canManage || isClosed(alert.status)) return null;
  const available = TRANSITIONS.filter((t) => t.status !== alert.status);
  return (
    <div className="sc-actions" data-testid="alert-actions">
      {available.map((t) => (
        <Button key={t.status} type="button" variant={t.noteRequired ? "primary" : "secondary"} onClick={() => setPending(t)}>
          {tt(`alertAction.${t.status}`)}
        </Button>
      ))}
      {pending ? (
        <CommandDialog
          title={tt(`alertAction.${pending.status}`)}
          description={tt("alerts.transitionBody", { status: label("alertStatus", pending.status) })}
          confirmLabel={tt(`alertAction.${pending.status}`)}
          command={COMMAND}
          buildBody={(note) => ({ alertId: alert.alertId, status: pending.status, ...(note ? { note } : {}) })}
          noteLabel={pending.noteRequired ? tt("alerts.noteRequired") : tt("common.noteOptional")}
          noteRequired={pending.noteRequired}
          onClose={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}

export function AlertDetail({ alertId, search }: { alertId: string; search: string }) {
  const { tt, formatTime } = useT();
  const query = useAlert(alertId);
  const alert = query.data;
  return (
    <div className="sc-stack">
      <Link className="sc-link sc-back" to={`/security-center/security${search}`}>{tt("alerts.back")}</Link>
      {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {alert ? (
        <section className="sc-panel" aria-labelledby="sc-alert-title" data-testid="alert-detail">
          <div className="sc-header-row">
            <h2 id="sc-alert-title" className="sc-panel__title">{alert.event}</h2>
            <span className="sc-inline"><RiskTag value={alert.severity} /><AlertStatusTag status={alert.status} /></span>
          </div>
          <p className="sc-text">{alert.description}</p>
          <DefList
            items={[
              { label: tt("alerts.source"), value: alert.source },
              { label: tt("alerts.occurrences"), value: alert.occurrences },
              { label: tt("alerts.createdAt"), value: formatTime(alert.createdAt) },
              { label: tt("alerts.updatedAt"), value: formatTime(alert.updatedAt) },
              ...(alert.projectId ? [{ label: tt("alerts.project"), value: alert.projectId }] : []),
              ...(alert.agentId ? [{ label: tt("alerts.agent"), value: alert.agentId }] : []),
              ...(alert.taskId ? [{ label: tt("alerts.task"), value: alert.taskId }] : []),
              ...(alert.executionId ? [{ label: tt("alerts.execution"), value: alert.executionId }] : []),
            ]}
          />
          <div className="sc-sub">
            <h3 className="sc-sub__title">{tt("alerts.evidence")}</h3>
            <Readable value={alert.evidence} />
          </div>
          <div className="sc-sub">
            <h3 className="sc-sub__title">{tt("alerts.history")}</h3>
            <ol className="sc-timeline">
              {alert.history.map((h, index) => (
                <li key={`${h.at}-${index}`} className="sc-timeline__item">
                  <div className="sc-row__meta">
                    <AlertStatusTag status={h.status} />
                    <span className="sc-muted">{formatTime(h.at)}</span>
                    <span className="sc-muted">{h.by}</span>
                  </div>
                  {h.note ? <p className="sc-text">{h.note}</p> : null}
                </li>
              ))}
            </ol>
          </div>
          <LifecycleActions alert={alert} />
        </section>
      ) : null}
    </div>
  );
}

function AlertRow({ alert, search, pinned }: { alert: Alert; search: string; pinned: boolean }) {
  const { tt, formatTime } = useT();
  return (
    <li className={`sc-row sc-alert-row${pinned ? " is-pinned" : ""}`} data-alert-id={alert.alertId} data-severity={alert.severity} data-pinned={pinned}>
      <div className="sc-row__head">
        <Link className="sc-link sc-row__title" to={`/security-center/security/${encodeURIComponent(alert.alertId)}${search}`}>{alert.event}</Link>
        <span className="sc-inline"><RiskTag value={alert.severity} /><AlertStatusTag status={alert.status} /></span>
      </div>
      <p className="sc-row__summary">{alert.description}</p>
      <div className="sc-row__meta">
        <span className="sc-muted">{alert.source}</span>
        <span className="sc-muted">{tt("alerts.occurrencesCount", { count: alert.occurrences })}</span>
        <span className="sc-muted">{formatTime(alert.updatedAt)}</span>
      </div>
    </li>
  );
}

export function AlertsTab({ projectId, search, alertId }: { projectId: string | undefined; search: string; alertId: string | undefined }) {
  const { tt, label } = useT();
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [open, setOpen] = useState(false);
  const query = useAlerts({ status, severity, open }, projectId);
  if (alertId) return <AlertDetail alertId={alertId} search={search} />;
  const { pinned, rest } = splitAlerts(query.data ?? []);
  return (
    <div className="sc-stack">
      <div className="sc-filters" role="group" aria-label={tt("alerts.filters")}>
        <Select label={tt("alerts.status")} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{tt("common.any")}</option>
          {ALERT_STATUSES.map((s) => <option key={s} value={s}>{label("alertStatus", s)}</option>)}
        </Select>
        <Select label={tt("alerts.severity")} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">{tt("common.any")}</option>
          {ALERT_SEVERITIES.map((s) => <option key={s} value={s}>{label("risk", s)}</option>)}
        </Select>
        <label className="sc-check">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          {tt("alerts.openOnly")}
        </label>
      </div>
      {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.length === 0 ? <Empty title={tt("alerts.emptyTitle")} body={tt("alerts.emptyBody")} /> : null}
      {pinned.length > 0 ? (
        <section className="sc-panel sc-panel--pinned" aria-labelledby="sc-pinned-title" data-testid="pinned-alerts">
          <h2 id="sc-pinned-title" className="sc-panel__title"><Pin size={16} aria-hidden /> {tt("alerts.pinned")}</h2>
          <ul className="sc-rows">{pinned.map((a) => <AlertRow key={a.alertId} alert={a} search={search} pinned />)}</ul>
        </section>
      ) : null}
      {rest.length > 0 ? (
        <section className="sc-panel" aria-labelledby="sc-other-title" data-testid="other-alerts">
          <h2 id="sc-other-title" className="sc-panel__title">{tt("alerts.others")}</h2>
          <ul className="sc-rows">{rest.map((a) => <AlertRow key={a.alertId} alert={a} search={search} pinned={false} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}
