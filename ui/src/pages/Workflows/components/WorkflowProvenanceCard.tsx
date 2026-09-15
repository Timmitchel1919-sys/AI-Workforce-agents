import { Link } from "react-router-dom";
import type {
  AuditEventView,
  TaskView,
  WorkflowView,
} from "../../../api/contracts";
import {
  Card,
  CardBody,
  EmptyState,
  Identifier,
  KeyValue,
} from "../../../components/ui";

/** Read-only provenance assembled only from workflow-scoped views already loaded by detail. */
export function WorkflowProvenanceCard({
  workflow,
  tasks,
  events,
}: {
  workflow: WorkflowView;
  tasks: readonly TaskView[];
  events: readonly AuditEventView[];
}) {
  const workflowTasks = tasks.filter(
    (task) => task.workflowId === workflow.workflowId,
  );
  const correlationId = events.find(
    (event) => event.correlationId,
  )?.correlationId;
  if (workflowTasks.length === 0 && workflow.participatingAgents.length === 0) {
    return (
      <EmptyState
        title="Workflow provenance is limited"
        detail="The Control Plane has not exposed linked tasks or participating agents for this workflow."
      />
    );
  }
  return (
    <Card>
      <CardBody>
        <KeyValue
          rows={[
            {
              key: "Workflow ID",
              value: <Identifier value={workflow.workflowId} truncate />,
            },
            {
              key: "Definition version",
              value: "Not exposed by the Control Plane",
            },
            { key: "Execution ID", value: "Not exposed by the Control Plane" },
            {
              key: "Trigger / created by",
              value: "Not exposed by the Control Plane",
            },
            {
              key: "Correlation ID",
              value: correlationId ? (
                <Identifier value={correlationId} truncate />
              ) : (
                "Not exposed by the Control Plane"
              ),
            },
          ]}
        />
        <div className="workflow-provenance__links">
          <strong>Participating agents</strong>
          <ul>
            {workflow.participatingAgents.map((agentId) => (
              <li key={agentId}>
                <Link to={`/agents/${encodeURIComponent(agentId)}`}>
                  {agentId}
                </Link>
              </li>
            ))}
          </ul>
          <strong>Loaded workflow tasks</strong>
          {workflowTasks.length ? (
            <ul>
              {workflowTasks.map((task) => (
                <li key={task.taskId}>
                  <Link to={`/tasks/${encodeURIComponent(task.taskId)}`}>
                    {task.taskId}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption">
              No tasks were returned in the bounded workflow task query.
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
