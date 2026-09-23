import { Link } from "react-router-dom";
import { Badge, StatusBadge } from "../../../components/ui";
import type { WorkflowView } from "../../../features/workflows";
import { WorkflowProgressBar } from "./WorkflowProgressBar";
import {
  formatDate,
  formatStatusLabel,
  mapWorkflowStatusToBadge,
  workflowDisplayStatus,
} from "./workflowStatus";

export function WorkflowRow({ workflow }: { workflow: WorkflowView }) {
  const displayStatus = workflowDisplayStatus(workflow);

  return (
    <tr className="workflow-row">
      <td className="workflow-row__cell workflow-row__cell--primary">
        <Link
          to={`/workflows/${workflow.workflowId}`}
          className="workflow-row__link"
          aria-label={`View details for ${workflow.name}`}
        >
          <div className="workflow-row__name-block">
            <span className="workflow-row__name">{workflow.name}</span>
            <span className="workflow-row__description">{workflow.description}</span>
          </div>
        </Link>
      </td>
      <td className="workflow-row__cell">
        <div className="workflow-row__status">
          <StatusBadge status={mapWorkflowStatusToBadge(displayStatus)}>
            {formatStatusLabel(displayStatus)}
          </StatusBadge>
          {workflow.pendingApprovals > 0 ? (
            <Badge variant="warning">
              {workflow.pendingApprovals} approval{workflow.pendingApprovals === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="workflow-row__cell">
        <WorkflowProgressBar progress={workflow.progress} />
      </td>
      <td className="workflow-row__cell workflow-row__cell--muted">
        {workflow.participatingAgents.length > 0
          ? workflow.participatingAgents.join(", ")
          : "—"}
      </td>
      <td className="workflow-row__cell workflow-row__cell--muted">{workflow.projectId}</td>
      <td className="workflow-row__cell workflow-row__cell--muted">
        {formatDate(workflow.updatedAt)}
      </td>
    </tr>
  );
}

export default WorkflowRow;
