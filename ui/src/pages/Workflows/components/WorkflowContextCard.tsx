import { Link } from "react-router-dom";
import type { WorkflowView } from "../../../api/contracts";
import { Card, CardBody, KeyValue } from "../../../components/ui";

export function WorkflowContextCard({ workflow }: { workflow: WorkflowView }) {
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
              key: "Owner / team",
              value: "Not exposed by the Control Plane",
            },
            {
              key: "Environment",
              value: "Not exposed by the Control Plane",
            },
            {
              key: "Workflow metadata",
              value: workflow.paused
                ? (workflow.pauseReason ?? "Paused")
                : "No pause recorded",
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}
