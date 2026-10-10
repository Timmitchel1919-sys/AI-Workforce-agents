import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useAuditTrail, type AuditFilter, type AuditItem } from "../../features/governance";
import { useProjects } from "../../features/executionPlans";
import { formatDateTime, useI18n } from "../../i18n";
import "../Approvals/ApprovalsPage.css";

/** Mirrors `AUDIT_EVENT_TYPES` in contracts/index.ts (filter options only). */
const EVENT_TYPES = [
  "access_event",
  "agent_activity",
  "agent_executed",
  "approval_decided",
  "approval_requested",
  "control_command",
  "environment_discovered",
  "environment_refreshed",
  "environment_unavailable",
  "execution_plan_event",
  "handoff_created",
  "host_registered",
  "model_execution_completed",
  "model_execution_failed",
  "model_execution_started",
  "model_provider_requested",
  "permission_decision",
  "project_adapter_event",
  "task_assigned",
  "task_completed",
  "task_created",
  "task_failed",
  "task_resumed",
  "tool_execution",
  "tool_registered",
  "workflow_event",
] as const;

const EMPTY: AuditFilter = {};

/** `datetime-local` value → ISO string (the API compares ISO timestamps). */
function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * The audit trail: server-filtered, cursor-paginated, redacted by the
 * Control Plane and scoped to the operator's projects. Read-only.
 */
export default function AuditLogPage() {
  const { t } = useI18n();
  const { projects } = useProjects();
  const [draft, setDraft] = useState({ type: "", outcome: "", actor: "", projectId: "", correlationId: "", since: "", until: "" });
  const [filter, setFilter] = useState<AuditFilter>(EMPTY);
  const trail = useAuditTrail(filter);
  const filtered = Object.values(filter).some(Boolean);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilter({
      ...(draft.type ? { type: draft.type } : {}),
      ...(draft.outcome.trim() ? { outcome: draft.outcome.trim() } : {}),
      ...(draft.actor.trim() ? { actor: draft.actor.trim() } : {}),
      ...(draft.projectId ? { projectId: draft.projectId } : {}),
      ...(draft.correlationId.trim() ? { correlationId: draft.correlationId.trim() } : {}),
      ...(toIso(draft.since) ? { since: toIso(draft.since) } : {}),
      ...(toIso(draft.until) ? { until: toIso(draft.until) } : {}),
    });
  };
  const clear = () => {
    setDraft({ type: "", outcome: "", actor: "", projectId: "", correlationId: "", since: "", until: "" });
    setFilter(EMPTY);
  };
  const field = (key: keyof typeof draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value })),
  });

  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={t("auditLog.title")} description={t("auditLog.description")} />

      <form className="gov-filters gov-filters--wide" aria-label={t("auditLog.filtersLabel")} onSubmit={apply}>
        <label className="gov-field">
          <span>{t("auditLog.type")}</span>
          <select {...field("type")}>
            <option value="">{t("auditLog.allTypes")}</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="gov-field">
          <span>{t("auditLog.project")}</span>
          <select {...field("projectId")}>
            <option value="">{t("auditLog.allProjects")}</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="gov-field">
          <span>{t("auditLog.outcome")}</span>
          <input maxLength={40} {...field("outcome")} />
        </label>
        <label className="gov-field">
          <span>{t("auditLog.actor")}</span>
          <input maxLength={128} {...field("actor")} />
        </label>
        <label className="gov-field">
          <span>{t("auditLog.correlationId")}</span>
          <input maxLength={128} {...field("correlationId")} />
        </label>
        <label className="gov-field">
          <span>{t("auditLog.since")}</span>
          <input type="datetime-local" {...field("since")} />
        </label>
        <label className="gov-field">
          <span>{t("auditLog.until")}</span>
          <input type="datetime-local" {...field("until")} />
        </label>
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={clear}>
            {t("auditLog.clear")}
          </button>
          <button type="submit" className="ui-button primary">
            {t("auditLog.apply")}
          </button>
        </div>
      </form>

      {trail.state === "loading" ? (
        <div className="gov-list" role="status" aria-label={t("auditLog.loading")}>
          <Skeleton height={64} width="100%" />
          <Skeleton height={64} width="100%" />
        </div>
      ) : trail.state === "forbidden" || trail.state === "unauthenticated" ? (
        <ErrorState
          icon={<Lock size={28} />}
          title={t(trail.state === "forbidden" ? "auditLog.forbiddenTitle" : "auditLog.unauthenticatedTitle")}
          description={t(trail.state === "forbidden" ? "auditLog.forbiddenDescription" : "auditLog.unauthenticatedDescription")}
        />
      ) : trail.state === "empty" ? (
        <EmptyState title={t("auditLog.emptyTitle")} description={filtered ? t("auditLog.emptyFiltered") : undefined} />
      ) : trail.state !== "ready" ? (
        <ErrorState title={t("auditLog.errorTitle")} description={t("auditLog.errorDescription")} onRetry={trail.refetch} retryLabel={t("common.retry")} />
      ) : (
        <>
          <p className="gov-muted">
            {t("auditLog.showing", { shown: trail.items.length, total: trail.total })} · {t("auditLog.redactedNote")}
          </p>
          <ol className="gov-list gov-audit">
            {trail.items.map((event) => (
              <AuditRow key={event.id} event={event} projectName={projects.find((p) => p.projectId === event.projectId)?.displayName} />
            ))}
          </ol>
          {trail.hasMore ? (
            <button type="button" className="ui-button" onClick={trail.loadMore} disabled={trail.loadingMore}>
              {t("auditLog.loadMore")}
            </button>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}

function AuditRow({ event, projectName }: { event: AuditItem; projectName?: string }) {
  const { t, language } = useI18n();
  const context = [
    event.projectId ? (projectName ?? event.projectId) : undefined,
    event.taskId,
    event.workflowId,
    event.agentId,
    event.toolId,
    event.correlationId,
  ].filter(Boolean);
  const hasData = Object.keys(event.data ?? {}).length > 0;
  return (
    <li className="gov-audit__row" data-audit-type={event.type}>
      <div className="gov-card__head">
        <time className="gov-muted" dateTime={event.timestamp}>
          {formatDateTime(event.timestamp, language)}
        </time>
        <code className="gov-action">{event.type}</code>
        {event.outcome ? <span className="gov-pill gov-pill--neutral">{event.outcome}</span> : null}
        {event.actor ? <span className="gov-muted">{t("auditLog.byActor", { actor: event.actor })}</span> : null}
      </div>
      {context.length > 0 ? (
        <p className="gov-muted">
          {t("auditLog.context")}: {context.join(" · ")}
        </p>
      ) : null}
      <details className="gov-details">
        <summary>{t("auditLog.details")}</summary>
        {hasData ? <pre>{JSON.stringify(event.data, null, 2)}</pre> : <p className="gov-muted">{t("auditLog.noDetails")}</p>}
      </details>
    </li>
  );
}
