import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isApiError } from "../../../api";
import type { TaskView } from "../../../api/contracts";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Identifier,
  KeyValue,
  Skeleton,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";
import { formatDurationMs } from "../../../lib/duration";
import type { AgentExecutionView } from "../../Agents/executions";

function useElapsedDuration(
  execution: AgentExecutionView | null,
): number | null {
  const isRunning =
    execution?.status === "running" && Boolean(execution.startedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  if (!isRunning || !execution?.startedAt) return null;
  const startedAt = Date.parse(execution.startedAt);
  return Number.isNaN(startedAt) ? null : Math.max(0, now - startedAt);
}

/**
 * Task-local runtime intelligence derived only from the bounded, redacted
 * task audit feed. The Control Plane has no independent execution resource,
 * so this component deliberately does not invent logs, model calls, outputs,
 * progress, or artifacts.
 */
export function TaskRuntimeCard({
  task,
  execution,
  isPending,
  isError,
  error,
  onRetry,
}: {
  task: TaskView;
  execution: AgentExecutionView | null;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const elapsedMs = useElapsedDuration(execution);

  if (isPending) {
    return (
      <Card>
        <CardBody>
          <Skeleton height="10rem" />
        </CardBody>
      </Card>
    );
  }

  if (isError) {
    const forbidden = isApiError(error) && error.category === "forbidden";
    return (
      <Card>
        <CardBody>
          <ErrorState
            variant={forbidden ? "forbidden" : "network"}
            title={
              forbidden
                ? "Runtime details restricted"
                : "Runtime intelligence temporarily unavailable"
            }
            detail={
              forbidden
                ? "You do not have permission to view this task's runtime evidence."
                : "The task remains available, but its audit-backed runtime details could not be loaded."
            }
            action={
              forbidden ? undefined : (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              )
            }
          />
        </CardBody>
      </Card>
    );
  }

  if (!execution) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            title="No execution yet"
            detail="Runtime details will appear when this task begins execution."
          />
        </CardBody>
      </Card>
    );
  }

  const agentId = execution.agentId ?? task.assignedAgentId;
  return (
    <Card>
      <CardHeader actions={<StatusBadge status={execution.status} />}>
        Current execution
      </CardHeader>
      <CardBody>
        <KeyValue
          rows={[
            {
              key: "Execution ID",
              value: <Identifier value={execution.id} />,
            },
            {
              key: "Agent",
              value: agentId ? (
                <Link
                  to={`/agents/${encodeURIComponent(agentId)}`}
                  className="link"
                >
                  {agentId}
                </Link>
              ) : (
                "Not available"
              ),
            },
            {
              key: "Started",
              value: execution.startedAt ? (
                <Timestamp value={execution.startedAt} />
              ) : (
                "Not available"
              ),
            },
            {
              key: "Completed",
              value: execution.completedAt ? (
                <Timestamp value={execution.completedAt} />
              ) : execution.status === "running" ? (
                "Still running"
              ) : (
                "Not available"
              ),
            },
            {
              key: elapsedMs === null ? "Duration" : "Elapsed",
              value:
                elapsedMs === null
                  ? formatDurationMs(execution.durationMs)
                  : `${formatDurationMs(elapsedMs)} elapsed`,
            },
          ]}
        />

        {execution.status === "failed" ? (
          <Alert tone="danger" title="Execution failed">
            {execution.error ??
              "The execution failed. Review the governed audit trail for the available failure summary."}
          </Alert>
        ) : null}

        <p className="text-caption task-runtime__caption">
          Runtime state is derived from the bounded, task-scoped audit feed.
        </p>
      </CardBody>
    </Card>
  );
}
