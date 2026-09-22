import { Link } from "react-router-dom";
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
  const agentHref = `/agents/${agent.id}`;

  return (
    <tr className="agent-row">
      <td className="agent-row__cell agent-row__cell--primary">
        <Link to={agentHref} className="agent-row__link" aria-label={`View details for ${agent.name}`}>
          <div className="agent-row__name-block">
            <span className="agent-row__name">{agent.name}</span>
            {agent.description ? <span className="agent-row__description">{agent.description}</span> : null}
          </div>
        </Link>
      </td>
      <td className="agent-row__cell">
        <StatusBadge status={mapAgentStatusToBadge(agent.status)}>{agent.status}</StatusBadge>
      </td>
      <td className="agent-row__cell agent-row__cell--muted">{agent.model ?? "Unavailable"}</td>
      <td className="agent-row__cell">
        <div className="agent-row__capabilities">
          {agent.capabilities.length > 0 ? (
            agent.capabilities.slice(0, 3).map((capability) => (
              <Badge key={capability} variant="info">
                {capability}
              </Badge>
            ))
          ) : (
            <span className="agent-row__muted">No capabilities</span>
          )}
        </div>
      </td>
      <td className="agent-row__cell agent-row__cell--muted">{agent.activeTasks ?? 0}</td>
      <td className="agent-row__cell agent-row__cell--muted">{agent.health ?? "Unavailable"}</td>
      <td className="agent-row__cell agent-row__cell--muted">{agent.updatedAt ? new Date(agent.updatedAt).toLocaleString() : "Not reported"}</td>
    </tr>
  );
}

export default AgentRow;
