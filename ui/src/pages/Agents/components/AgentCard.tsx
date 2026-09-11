import { Link } from "react-router-dom";
import { Card, CardBody, KeyValue, StatusBadge } from "../../../components/ui";
import { Timestamp } from "../../../components/ui";
import { formatSuccessRate, type AgentListItem } from "../agentsView";

/**
 * Mobile / narrow-viewport presentation of one agent. Purely presentational:
 * data in through props, navigation via React Router `<Link>`, no fetching,
 * no mutation.
 */
export function AgentCard({ agent }: { agent: AgentListItem }) {
  return (
    <Card>
      <CardBody>
        <div className="agent-card__head">
          <Link
            to={`/agents/${encodeURIComponent(agent.id)}`}
            className="agent-card__name link"
          >
            {agent.name}
          </Link>
          <StatusBadge status={agent.status} />
        </div>
        <KeyValue
          rows={[
            { key: "Role", value: agent.role || "—" },
            {
              key: "Capabilities",
              value:
                agent.capabilities.length > 0
                  ? agent.capabilities.join(", ")
                  : "—",
            },
            { key: "Tasks", value: agent.taskCount },
            { key: "Success", value: formatSuccessRate(agent.successRate) },
            {
              key: "Project",
              value: agent.currentProjectId ?? "—",
            },
            {
              key: "Updated",
              value: <Timestamp value={agent.lastActivityAt} relative />,
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}
