import { Link } from "react-router-dom";
import { formatDateTime, translateStatus, useI18n } from "../../../i18n";
import { Badge, StatusBadge } from "../../../components/ui";
import type { AgentListItem } from "../../../features/agents";

type BadgeStatus = "online" | "offline" | "idle" | "active" | "running" | "pending" | "completed" | "failed" | "paused" | "blocked";

function mapAgentStatusToBadge(status: AgentListItem["status"]): BadgeStatus {
  switch (status) {
    case "active":
      return "active";
    case "idle":
      return "idle";
    case "paused":
      return "paused";
    case "offline":
      return "offline";
    case "error":
      return "blocked";
    case "provisioning":
      return "pending";
    default:
      return "offline";
  }
}

export function AgentRow({ agent }: { agent: AgentListItem }) {
  const { t, language } = useI18n();
  const agentHref = `/agents/${agent.id}`;

  return (
    <tr className="agent-row">
      <td className="agent-row__cell agent-row__cell--primary">
        <Link to={agentHref} className="agent-row__link" aria-label={t("common.viewDetails", { name: agent.name })}>
          <div className="agent-row__name-block">
            <span className="agent-row__name">{agent.name}</span>
            {agent.description ? <span className="agent-row__description">{agent.description}</span> : null}
          </div>
        </Link>
      </td>
      <td className="agent-row__cell">
        <StatusBadge status={mapAgentStatusToBadge(agent.status)}>{translateStatus(t, agent.status)}</StatusBadge>
      </td>
      <td className="agent-row__cell agent-row__cell--muted">{agent.model ?? t("common.unavailable")}</td>
      <td className="agent-row__cell">
        <div className="agent-row__capabilities">
          {agent.capabilities.length > 0 ? (
            agent.capabilities.slice(0, 3).map((capability) => (
              <Badge key={capability} variant="info">
                {capability}
              </Badge>
            ))
          ) : (
            <span className="agent-row__muted">{t("agents.noCapabilities")}</span>
          )}
        </div>
      </td>
      <td className="agent-row__cell agent-row__cell--muted">{agent.activeTasks ?? 0}</td>
      <td className="agent-row__cell agent-row__cell--muted">{agent.health ?? t("common.unavailable")}</td>
      <td className="agent-row__cell agent-row__cell--muted">{formatDateTime(agent.updatedAt, language) ?? t("common.notReported")}</td>
    </tr>
  );
}

export default AgentRow;
