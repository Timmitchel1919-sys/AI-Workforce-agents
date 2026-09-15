import { Link } from "react-router-dom";
import type { TaskView, WorkflowView } from "../../../api/contracts";
import {
  Card,
  CardBody,
  EmptyState,
  KeyValue,
  StatusBadge,
} from "../../../components/ui";

/**
 * The approval list API has no workflowId filter. This card deliberately uses
 * only the workflow's count and approval references already present on the
 * Control Plane task view, rather than loading unrelated global approvals.
 */
export function WorkflowApprovalSummary({
  workflow,
  tasks,
}: {
  workflow: WorkflowView;
  tasks: readonly TaskView[];
}) {
  const taskApprovals = tasks.filter(
    (task) => task.workflowId === workflow.workflowId && task.approvalId,
  );
  if (workflow.pendingApprovals === 0 && taskApprovals.length === 0) {
    return (
      <EmptyState
        title="No workflow approvals exposed"
        detail="The Control Plane reports no pending approvals for this workflow."
      />
    );
  }
  return (
    <Card>
      <CardBody>
        <KeyValue
          rows={[
            { key: "Pending approvals", value: workflow.pendingApprovals },
            {
              key: "Approval records",
              value:
                "Scoped workflow approval records are not exposed by the current API",
            },
          ]}
        />
        {taskApprovals.length ? (
          <ul
            className="workflow-approval-list"
            aria-label="Task approval references"
          >
            {taskApprovals.map((task) => (
              <li key={task.taskId}>
                <Link
                  to={`/tasks/${encodeURIComponent(task.taskId)}`}
                  className="link"
                >
                  {task.taskId}
                </Link>
                <span>Approval {task.approvalId}</span>
                {task.approvalState ? (
                  <StatusBadge status={task.approvalState} />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-caption">
          <Link to="/approvals" className="link">
            Open Approvals
          </Link>{" "}
          to review decisions through the centralized approval module.
        </p>
      </CardBody>
    </Card>
  );
}
