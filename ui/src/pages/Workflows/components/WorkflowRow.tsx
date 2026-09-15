import { Link } from "react-router-dom";
import type { WorkflowView } from "../../../api/contracts";
import {
  Card,
  CardBody,
  Identifier,
  KeyValue,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";

export function WorkflowRow({ workflow }: { workflow: WorkflowView }) {
  return (
    <Card>
      <CardBody>
        <div className="workflow-card__head">
          <Link
            to={`/workflows/${encodeURIComponent(workflow.workflowId)}`}
            className="workflow-card__title link"
          >
            {workflow.name}
          </Link>
          <StatusBadge status={workflow.status} />
        </div>
        <KeyValue
          rows={[
            {
              key: "Workflow ID",
              value: (
                <Identifier
                  value={workflow.workflowId}
                  truncate
                  copyable={false}
                />
              ),
            },
            { key: "Project", value: workflow.projectId },
            { key: "Stages", value: workflow.stages.length },
            { key: "Agents", value: workflow.participatingAgents.length },
            {
              key: "Updated",
              value: <Timestamp value={workflow.updatedAt} relative />,
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}
