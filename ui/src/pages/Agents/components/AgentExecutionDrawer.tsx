import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Drawer,
  Identifier,
  KeyValue,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";
import { ChevronRight } from "../../../components/ui/icons";
import { Stack } from "../../../components/layout";
import { useTask } from "../../../features/tasks";
import { formatDurationMs } from "../../../lib/duration";
import type { AgentExecutionView } from "../executions";

function Chain({ children }: { children: ReactNode }) {
  return (
    <div
      className="ui-inline"
      style={{ gap: "var(--space-xs)" }}
      aria-label="Execution relationship"
    >
      {children}
    </div>
  );
}

/**
 * Execution detail — the "click a row, see everything real about it" view
 * (STEP 15). Lazily fetches the associated Task only once an execution is
 * selected (`useTask`, disabled until then), which is also the only place
 * Workflow/Project association is available for these events — the audit
 * records themselves don't carry `workflowId` for agent_executed/
 * task_completed/task_failed. No result payload exists on the Task contract,
 * so no result section is rendered (nothing to fabricate).
 */
export function AgentExecutionDrawer({
  execution,
  onClose,
}: {
  execution: AgentExecutionView | null;
  onClose: () => void;
}) {
  const taskQuery = useTask(execution?.taskId);
  const task = taskQuery.data;
  const projectId = task?.projectId ?? execution?.projectId;

  const elapsedMs =
    execution?.status === "running" && execution.startedAt
      ? Date.now() - Date.parse(execution.startedAt)
      : null;

  return (
    <Drawer
      open={execution !== null}
      onClose={onClose}
      title={execution ? "Execution detail" : "Execution"}
    >
      {execution ? (
        <Stack gap="md">
          <Chain>
            <span className="text-caption">Agent</span>
            <ChevronRight width={14} height={14} aria-hidden="true" />
            <span className="text-caption">Execution</span>
            {execution.taskId ? (
              <>
                <ChevronRight width={14} height={14} aria-hidden="true" />
                <Link
                  to={`/tasks/${encodeURIComponent(execution.taskId)}`}
                  className="link"
                >
                  Task
                </Link>
              </>
            ) : null}
            {task?.workflowId ? (
              <>
                <ChevronRight width={14} height={14} aria-hidden="true" />
                <Link
                  to={`/workflows/${encodeURIComponent(task.workflowId)}`}
                  className="link"
                >
                  Workflow
                </Link>
              </>
            ) : null}
            {projectId ? (
              <>
                <ChevronRight width={14} height={14} aria-hidden="true" />
                <Link
                  to={`/projects/${encodeURIComponent(projectId)}`}
                  className="link"
                >
                  Project
                </Link>
              </>
            ) : null}
          </Chain>

          <KeyValue
            rows={[
              {
                key: "Execution ID",
                value: <Identifier value={execution.id} />,
              },
              {
                key: "Status",
                value: <StatusBadge status={execution.status} />,
              },
              {
                key: "Task",
                value: execution.taskId ? (
                  <Link
                    to={`/tasks/${encodeURIComponent(execution.taskId)}`}
                    className="link"
                  >
                    {execution.taskId}
                  </Link>
                ) : (
                  "Not available"
                ),
              },
              {
                key: "Workflow",
                value: task?.workflowId ? (
                  <Link
                    to={`/workflows/${encodeURIComponent(task.workflowId)}`}
                    className="link"
                  >
                    {task.workflowId}
                  </Link>
                ) : taskQuery.isPending && execution.taskId ? (
                  "Loading…"
                ) : (
                  "Not available"
                ),
              },
              {
                key: "Project",
                value: projectId ? (
                  <Link
                    to={`/projects/${encodeURIComponent(projectId)}`}
                    className="link"
                  >
                    {projectId}
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
                key: "Duration",
                value:
                  elapsedMs !== null
                    ? `${formatDurationMs(elapsedMs)} elapsed`
                    : formatDurationMs(execution.durationMs),
              },
            ]}
          />

          {task?.description ? (
            <div>
              <p className="text-label">Task description</p>
              <p className="text-body-sm">{task.description}</p>
            </div>
          ) : null}

          {execution.status === "failed" ? (
            <Alert tone="danger" title="Execution failed">
              {execution.error ?? "Execution failed"}
            </Alert>
          ) : null}

          {task && task.retryCount > 0 ? (
            <p className="text-caption">
              This task has been retried {task.retryCount}{" "}
              {task.retryCount === 1 ? "time" : "times"}.
            </p>
          ) : null}

          <p className="text-caption">
            Execution history is derived from the audit trail, not the audit log
            itself.{" "}
            <Link to="/audit" className="link">
              Open Audit Log
            </Link>{" "}
            for the full governance record.
          </p>
        </Stack>
      ) : null}
    </Drawer>
  );
}
