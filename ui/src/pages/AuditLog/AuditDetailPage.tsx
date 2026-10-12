import { Link, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import { ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useAuditEvent, type AuditItem } from "../../features/governance";
import { useProjects } from "../../features/executionPlans";
import { formatDateTime, useI18n } from "../../i18n";
import "../Approvals/ApprovalsPage.css";

/**
 * A single, immutable audit event. Read-only by design: an audit record is
 * append-only and can never be edited or deleted from the Control Center. The
 * Control Plane has already redacted sensitive values.
 */
export default function AuditDetailPage() {
  const { t } = useI18n();
  const { eventId } = useParams<{ eventId: string }>();
  const { projects } = useProjects();
  const { state, item, refetch } = useAuditEvent(eventId);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("auditLog.detailTitle")}
        description={t("auditLog.detailDescription")}
      />

      <p>
        <Link to="/audit-log" className="gov-back">
          <ArrowLeft size={16} aria-hidden /> {t("auditLog.detailBack")}
        </Link>
      </p>

      {state === "loading" ? (
        <div
          className="gov-list"
          role="status"
          aria-label={t("auditLog.detailLoading")}
        >
          <Skeleton height={160} width="100%" />
        </div>
      ) : state === "forbidden" || state === "unauthenticated" ? (
        <ErrorState
          icon={<Lock size={28} />}
          title={t(
            state === "forbidden"
              ? "auditLog.forbiddenTitle"
              : "auditLog.unauthenticatedTitle",
          )}
          description={t(
            state === "forbidden"
              ? "auditLog.forbiddenDescription"
              : "auditLog.unauthenticatedDescription",
          )}
        />
      ) : state === "not_found" || !item ? (
        <ErrorState
          title={t("auditLog.detailNotFoundTitle")}
          description={t("auditLog.detailNotFoundDescription")}
        />
      ) : state !== "ready" ? (
        <ErrorState
          title={t("auditLog.errorTitle")}
          description={t("auditLog.errorDescription")}
          onRetry={refetch}
          retryLabel={t("common.retry")}
        />
      ) : (
        <AuditDetail
          item={item}
          projectName={
            projects.find((p) => p.projectId === item.projectId)?.displayName
          }
        />
      )}
    </PageContainer>
  );
}

function AuditDetail({
  item,
  projectName,
}: {
  item: AuditItem;
  projectName?: string;
}) {
  const { t, language } = useI18n();
  const hasData = Object.keys(item.data ?? {}).length > 0;
  const row = (label: string, value: ReactNode) => (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );

  return (
    <section className="gov-card gov-card--detail" data-audit-type={item.type}>
      <div className="gov-card__head">
        <time className="gov-muted" dateTime={item.timestamp}>
          {formatDateTime(item.timestamp, language)}
        </time>
        <code className="gov-action">{item.type}</code>
        {item.outcome ? (
          <span className="gov-pill gov-pill--neutral">{item.outcome}</span>
        ) : null}
      </div>

      <p className="gov-notice">{t("auditLog.immutableNote")}</p>

      <dl className="gov-detail-list">
        {row(t("auditLog.detailFieldId"), <code>{item.id}</code>)}
        {item.actor ? row(t("auditLog.actor"), item.actor) : null}
        {item.projectId
          ? row(t("auditLog.project"), projectName ?? item.projectId)
          : null}
        {item.taskId
          ? row(
              t("auditLog.detailFieldTask"),
              <Link to={`/tasks/${encodeURIComponent(item.taskId)}`}>
                {item.taskId}
              </Link>,
            )
          : null}
        {item.workflowId
          ? row(
              t("auditLog.detailFieldWorkflow"),
              <Link to={`/workflows/${encodeURIComponent(item.workflowId)}`}>
                {item.workflowId}
              </Link>,
            )
          : null}
        {item.agentId
          ? row(t("auditLog.detailFieldAgent"), <code>{item.agentId}</code>)
          : null}
        {item.toolId
          ? row(t("auditLog.detailFieldTool"), <code>{item.toolId}</code>)
          : null}
        {item.correlationId
          ? row(t("auditLog.correlationId"), <code>{item.correlationId}</code>)
          : null}
      </dl>

      <section className="gov-details" aria-label={t("auditLog.details")}>
        <h2>{t("auditLog.details")}</h2>
        {hasData ? (
          <pre>{JSON.stringify(item.data, null, 2)}</pre>
        ) : (
          <p className="gov-muted">{t("auditLog.noDetails")}</p>
        )}
        <p className="gov-muted">{t("auditLog.redactedNote")}</p>
      </section>
    </section>
  );
}
