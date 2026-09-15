import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isApiError } from "../../../api";
import type { WorkflowView } from "../../../api/contracts";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  KeyValue,
  Progress,
  Skeleton,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";
import { durationBetween, formatDurationMs } from "../../../lib/duration";

function useWorkflowElapsed(workflow: WorkflowView): number | null {
  const running = workflow.status === "running" && Boolean(workflow.startedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  return running && workflow.startedAt
    ? durationBetween(workflow.startedAt, new Date(now).toISOString())
    : null;
}

export function WorkflowRuntimeCard({
  workflow,
  isPending,
  isError,
  error,
  onRetry,
}: {
  workflow: WorkflowView;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const elapsedMs = useWorkflowElapsed(workflow);

  if (isPending) {
    return <Skeleton height="12rem" />;
  }
  if (isError) {
    const forbidden = isApiError(error) && error.category === "forbidden";
    return (
      <ErrorState
        variant={forbidden ? "forbidden" : "network"}
        title={
          forbidden
            ? "Runtime details restricted"
            : "Runtime intelligence temporarily unavailable"
        }
        detail={
          forbidden
            ? "You do not have permission to view this workflow's runtime evidence."
            : "The workflow remains available, but its bounded runtime evidence could not be loaded."
        }
        action={
          forbidden ? undefined : (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )
        }
      />
    );
  }
  if (!workflow.startedAt && workflow.status === "created") {
    return (
      <EmptyState
        title="No executions yet"
        detail="Runtime details will appear when this workflow begins execution."
      />
    );
  }

  const durationMs = durationBetween(workflow.startedAt, workflow.completedAt);
  const duration = elapsedMs ?? durationMs;
  return (
    <Card>
      <CardHeader actions={<StatusBadge status={workflow.status} />}>
        Current workflow runtime
      </CardHeader>
      <CardBody>
        <KeyValue
          rows={[
            { key: "Execution ID", value: "Not exposed by the Control Plane" },
            {
              key: "Current step",
              value: workflow.currentSpecId ? (
                <Link
                  to={`#workflow-step-${encodeURIComponent(workflow.currentSpecId)}`}
                  className="link"
                >
                  {workflow.currentSpecId}
                </Link>
              ) : (
                "Not available"
              ),
            },
            { key: "Started", value: <Timestamp value={workflow.startedAt} /> },
            {
              key: "Completed",
              value: <Timestamp value={workflow.completedAt} />,
            },
            {
              key: elapsedMs === null ? "Duration" : "Elapsed",
              value:
                elapsedMs === null
                  ? formatDurationMs(duration)
                  : `${formatDurationMs(duration)} elapsed`,
            },
          ]}
        />
        <div className="workflow-runtime__progress">
          <span className="text-label">Authoritative progress</span>
          <Progress value={workflow.progress.fraction} />
        </div>
        {workflow.status === "failed" && workflow.error ? (
          <Alert tone="danger" title="Workflow failed">
            {workflow.error}
          </Alert>
        ) : null}
        {workflow.status === "completed" ? (
          <Alert tone="success" title="Workflow completed">
            The Control Plane reports this workflow as completed. A result
            summary is not exposed.
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}
