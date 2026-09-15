import { Link } from "react-router-dom";
import type { WorkflowView } from "../../../api/contracts";
import { Card, CardBody, KeyValue } from "../../../components/ui";

export function WorkflowParticipantsCard({
  workflow,
}: {
  workflow: WorkflowView;
}) {
  return (
    <Card>
      <CardBody>
        <KeyValue
          rows={[
            {
              key: "Project",
              value: (
                <Link
                  to={`/projects/${encodeURIComponent(workflow.projectId)}`}
                  className="link"
                >
                  {workflow.projectId}
                </Link>
              ),
            },
            {
              key: "Participating agents",
              value: workflow.participatingAgents.length,
            },
            {
              key: "Linked tasks",
              value: "Not exposed by the Control Plane",
            },
          ]}
        />
        {workflow.participatingAgents.length ? (
          <ul
            className="workflow-participants"
            aria-label="Participating agents"
          >
            {workflow.participatingAgents.map((agentId) => (
              <li key={agentId}>
                <Link
                  to={`/agents/${encodeURIComponent(agentId)}`}
                  className="link"
                >
                  {agentId}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption">No participating agents are exposed.</p>
        )}
      </CardBody>
    </Card>
  );
}
