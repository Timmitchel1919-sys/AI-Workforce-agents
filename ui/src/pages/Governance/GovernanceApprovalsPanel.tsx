import { Link } from "react-router-dom";
import { EmptyState } from "../../components/ui";
import { useApprovalQueue, type RiskLevel } from "../../features/governance";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import { GovernanceGate } from "./GovernanceGate";

const RISK_LABEL: Record<RiskLevel, MessageKey> = {
  low: "approvalQueue.riskLow",
  medium: "approvalQueue.riskMedium",
  high: "approvalQueue.riskHigh",
};

const RISK_TONE: Record<RiskLevel, string> = {
  low: "neutral",
  medium: "warning",
  high: "negative",
};

/**
 * Approvals bound to this project that are still waiting for a human decision.
 * This page only lists them — deciding happens in the approval queue, and the
 * Control Plane authorizes, records and audits that decision.
 */
export function GovernanceApprovalsPanel({ projectId }: { projectId: string }) {
  const { t, language } = useI18n();
  const queue = useApprovalQueue({ status: "requested", projectId });

  return (
    <GovernanceGate state={queue.state} onRetry={queue.refetch}>
      {queue.state === "empty" ? (
        <EmptyState title={t("governance.approvalsEmpty")} />
      ) : (
        <>
          <ul className="gov-list">
            {queue.items.map((item) => (
              <li key={item.approvalId} className="gov-card gov-card--pending">
                <div className="gov-card__head">
                  <code className="gov-action">{item.action}</code>
                  <span className={`gov-pill gov-pill--${RISK_TONE[item.risk]}`}>
                    {t(RISK_LABEL[item.risk])}
                  </span>
                  <span className="gov-muted">
                    {t("approvalQueue.requestedBy", {
                      actor: item.requestedBy,
                      date: formatDateTime(item.requestedAt, language) ?? "",
                    })}
                  </span>
                </div>
                <p className="gov-reason">{item.reason}</p>
              </li>
            ))}
          </ul>
          <p>
            <Link to="/approvals">{t("governance.approvalsLink")}</Link>
          </p>
        </>
      )}
    </GovernanceGate>
  );
}
