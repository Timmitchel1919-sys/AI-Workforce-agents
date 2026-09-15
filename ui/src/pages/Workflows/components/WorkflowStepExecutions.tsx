import { Link } from "react-router-dom";
import {
  Card,
  CardBody,
  EmptyState,
  KeyValue,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";
import { formatDurationMs } from "../../../lib/duration";
import type { WorkflowStepExecutionView } from "../workflowRuntime";

export function WorkflowStepExecutions({
  steps,
}: {
  steps: readonly WorkflowStepExecutionView[];
}) {
  if (steps.length === 0) {
    return (
      <EmptyState
        title="No task executions yet"
        detail="No workflow task records are available in the current bounded result."
      />
    );
  }
  return (
    <div
      className="workflow-step-executions"
      aria-label="Workflow task executions"
    >
      {steps.map(({ task, execution }) => (
        <Card
          key={task.taskId}
          id={`workflow-step-${task.workflowSpecId ?? task.taskId}`}
        >
          <CardBody>
            <KeyValue
              rows={[
                {
                  key: "Step",
                  value: task.description || task.workflowSpecId || task.type,
                },
                { key: "Status", value: <StatusBadge status={task.status} /> },
                {
                  key: "Task",
                  value: (
                    <Link
                      className="link"
                      to={`/tasks/${encodeURIComponent(task.taskId)}`}
                    >
                      {task.taskId}
                    </Link>
                  ),
                },
                {
                  key: "Agent",
                  value: task.assignedAgentId ? (
                    <Link
                      className="link"
                      to={`/agents/${encodeURIComponent(task.assignedAgentId)}`}
                    >
                      {task.assignedAgentId}
                    </Link>
                  ) : (
                    "Not assigned"
                  ),
                },
                {
                  key: "Started",
                  value: <Timestamp value={execution?.startedAt} />,
                },
                {
                  key: "Duration",
                  value: formatDurationMs(execution?.durationMs),
                },
              ]}
            />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
