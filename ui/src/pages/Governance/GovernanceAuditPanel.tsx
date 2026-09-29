import { Link } from "react-router-dom";
import { EmptyState } from "../../components/ui";
import { useAuditTrail } from "../../features/governance";
import { formatDateTime, useI18n } from "../../i18n";
import { GovernanceGate } from "./GovernanceGate";

/**
 * The most recent events the Control Plane recorded for this project — the
 * same append-only trail the audit log shows, as a preview. Values are
 * redacted server-side; the browser never reads the raw store.
 */
export function GovernanceAuditPanel({ projectId }: { projectId: string }) {
  const { t, language } = useI18n();
  const trail = useAuditTrail({ projectId });

  return (
    <GovernanceGate state={trail.state} onRetry={trail.refetch}>
      {trail.state === "empty" ? (
        <EmptyState title={t("governance.auditEmpty")} />
      ) : (
        <>
          <ol className="gov-list gov-audit">
            {trail.items.map((event) => (
              <li key={event.id} className="gov-audit__row">
                <div className="gov-card__head">
                  <time className="gov-muted" dateTime={event.timestamp}>
                    {formatDateTime(event.timestamp, language)}
                  </time>
                  <code className="gov-action">{event.type}</code>
                  {event.outcome ? (
                    <span className="gov-pill gov-pill--neutral">{event.outcome}</span>
                  ) : null}
                  {event.actor ? (
                    <span className="gov-muted">{t("auditLog.byActor", { actor: event.actor })}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <p>
            <Link to="/audit-log">{t("governance.auditLink")}</Link>
          </p>
        </>
      )}
    </GovernanceGate>
  );
}
