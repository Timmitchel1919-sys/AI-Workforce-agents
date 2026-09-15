import { Badge, StatusBadge } from "../../../components/ui";
import type { WorkflowGraphNode as WorkflowGraphNodeModel } from "./workflowGraph.types";

export function WorkflowGraphNode({
  node,
  selected,
  onSelect,
}: {
  node: WorkflowGraphNodeModel;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <li className="workflow-graph__item" id={`workflow-step-${node.specId}`}>
      <button
        type="button"
        className="workflow-graph-node"
        data-current={node.isCurrent || undefined}
        data-selected={selected || undefined}
        aria-pressed={selected}
        aria-label={`${node.label}. ${node.status}${node.isCurrent ? ". Current step" : ""}`}
        onClick={() => onSelect(node.id)}
      >
        <span className="workflow-graph-node__header">
          <span className="workflow-graph-node__type">{node.type}</span>
          <StatusBadge status={node.status} />
        </span>
        <strong className="workflow-graph-node__label">{node.label}</strong>
        {node.isCurrent ? <Badge tone="info">Current step</Badge> : null}
        {node.agentId ? (
          <span className="workflow-graph-node__agent">
            Agent {node.agentId}
          </span>
        ) : null}
      </button>
    </li>
  );
}
