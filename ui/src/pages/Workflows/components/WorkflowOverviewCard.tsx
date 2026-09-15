import type { WorkflowView } from "../../../api/contracts";
import {
  Card,
  CardBody,
  KeyValue,
  Progress,
  StatusBadge,
} from "../../../components/ui";

export function WorkflowOverviewCard({ workflow }: { workflow: WorkflowView }) {
  const firstStage = workflow.stages.at(0);
  const lastStage = workflow.stages.at(-1);
  return (
    <Card>
      <CardBody>
        <p className="workflow-overview__description">{workflow.description}</p>
        <Progress value={workflow.progress.fraction} />
        <KeyValue
          rows={[
            { key: "Status", value: <StatusBadge status={workflow.status} /> },
            { key: "Stages", value: workflow.progress.total },
            { key: "Completed", value: workflow.progress.completed },
            { key: "Failed", value: workflow.progress.failed },
            { key: "Blocked", value: workflow.progress.blocked },
            {
              key: "Current stage",
              value: workflow.currentSpecId ?? "Not available",
            },
            {
              key: "First stage",
              value: firstStage ? firstStage.description : "No stages exposed",
            },
            {
              key: "Last stage",
              value: lastStage ? lastStage.description : "No stages exposed",
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}
