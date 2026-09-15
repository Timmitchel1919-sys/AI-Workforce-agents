import { Link } from "react-router-dom";
import {
  Card,
  CardBody,
  Identifier,
  KeyValue,
  StatusBadge,
} from "../../../components/ui";
import type { WorkflowGraphNode } from "./workflowGraph.types";

export function WorkflowNodeDetails({ node }: { node: WorkflowGraphNode }) {
  return (
    <Card>
      <CardBody>
        <KeyValue
          rows={[
            { key: "Step ID", value: <Identifier value={node.specId} /> },
            { key: "Type", value: node.type },
            { key: "Status", value: <StatusBadge status={node.status} /> },
            { key: "Description", value: node.description },
            {
              key: "Task",
              value: node.taskId ? (
                <Link to={`/tasks/${encodeURIComponent(node.taskId)}`}>
                  {node.taskId}
                </Link>
              ) : (
                "Not dispatched"
              ),
            },
            {
              key: "Agent",
              value: node.agentId ? (
                <Link to={`/agents/${encodeURIComponent(node.agentId)}`}>
                  {node.agentId}
                </Link>
              ) : (
                "Not assigned"
              ),
            },
            { key: "Retry count", value: node.retryCount },
            {
              key: "Dependencies",
              value: "Shown when published by the Control Plane",
            },
          ]}
        />
        {node.error ? (
          <p className="workflow-node-details__error">{node.error}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
