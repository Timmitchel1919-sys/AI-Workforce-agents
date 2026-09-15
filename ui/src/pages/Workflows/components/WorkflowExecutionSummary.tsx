import type { WorkflowView } from "../../../api/contracts";
import {
  Card,
  CardBody,
  KeyValue,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";

export function WorkflowExecutionSummary({
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
              key: "Workflow status",
              value: <StatusBadge status={workflow.status} />,
            },
            {
              key: "Current stage",
              value: workflow.currentSpecId ?? "Not available",
            },
            {
              key: "Started",
              value: <Timestamp value={workflow.startedAt} />,
            },
            {
              key: "Completed",
              value: <Timestamp value={workflow.completedAt} />,
            },
            { key: "Pending approvals", value: workflow.pendingApprovals },
            {
              key: "Execution ID / duration",
              value: "Not exposed by the Control Plane",
            },
          ]}
        />
        <p className="text-caption workflow-execution__caption">
          This is lightweight workflow state only. Logs and the execution graph
          are not loaded on this page.
        </p>
      </CardBody>
    </Card>
  );
}
