import {
  Alert,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Skeleton,
} from "../../../components/ui";
import { useBreakpointUp } from "../../../theme/breakpoints";
import { WorkflowGraphNode } from "./WorkflowGraphNode";
import type {
  WorkflowGraphEdge,
  WorkflowGraphNode as WorkflowGraphNodeModel,
} from "./workflowGraph.types";

/** Presentational graph: all data and selection state are supplied by the page. */
export function WorkflowGraph({
  nodes,
  edges,
  selectedNodeId,
  isLoading = false,
  error,
  onRetry,
  onSelect,
  hasCompleteTaskSet,
}: {
  nodes: readonly WorkflowGraphNodeModel[];
  edges: readonly WorkflowGraphEdge[];
  selectedNodeId?: string;
  isLoading?: boolean;
  error?: "forbidden" | "error";
  onRetry?: () => void;
  onSelect: (nodeId: string) => void;
  hasCompleteTaskSet: boolean;
}) {
  const desktop = useBreakpointUp("md");

  if (isLoading) {
    return <Skeleton height="14rem" aria-label="Loading workflow structure" />;
  }

  if (error) {
    return (
      <ErrorState
        variant={error === "forbidden" ? "forbidden" : "network"}
        title={
          error === "forbidden"
            ? "Access restricted"
            : "Unable to load workflow steps"
        }
        detail={
          error === "forbidden"
            ? "You do not have permission to view this workflow structure."
            : "The Control Center could not retrieve the workflow task relationships."
        }
        action={
          error === "error" && onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (nodes.length === 0) {
    return <EmptyState title="No workflow steps available" />;
  }

  return (
    <Card>
      <CardBody>
        <div className="workflow-graph__intro">
          <p className="text-caption">
            {desktop
              ? "Select a step to inspect its runtime details."
              : "Workflow steps"}
          </p>
          <p className="text-caption">
            {edges.length > 0
              ? `${edges.length} reported dependency relationship${edges.length === 1 ? "" : "s"}.`
              : "No dependency relationships are exposed for these steps."}
          </p>
        </div>
        {!hasCompleteTaskSet ? (
          <Alert tone="warning" title="Partial task relationship data">
            The Control Plane returned only part of this workflow&apos;s task
            set. Displayed dependency links may be incomplete.
          </Alert>
        ) : null}
        {edges.length === 0 ? (
          <Alert tone="info" title="Dependency graph unavailable">
            Workflow stage order is not treated as a dependency. The Control
            Plane has not published a relationship between these steps.
          </Alert>
        ) : null}
        <ol className="workflow-graph" aria-label="Workflow steps">
          {nodes.map((node) => (
            <WorkflowGraphNode
              key={node.id}
              node={node}
              selected={node.id === selectedNodeId}
              onSelect={onSelect}
            />
          ))}
        </ol>
        {edges.length > 0 ? (
          <ul
            className="workflow-graph__relationships"
            aria-label="Workflow dependencies"
          >
            {edges.map((edge) => (
              <li key={`${edge.source}-${edge.target}`}>
                {edge.source} {"\u2192"} {edge.target}
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}
