import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { isApiError } from "../../api";
import { PageFrame, Section, Stack } from "../../components/layout";
import {
  Alert,
  Button,
  Card,
  CardBody,
  ErrorState,
  Identifier,
  KeyValue,
  Skeleton,
  StatusBadge,
  Timestamp,
} from "../../components/ui";
import { ChevronLeft } from "../../components/ui/icons";
import { useAuditEvents } from "../../features/audit";
import { useTask } from "../../features/tasks";
import { pairExecutions } from "../Agents/executions";
import { TaskLifecycleTimeline } from "./components/TaskLifecycleTimeline";
import { TaskAuditSummary } from "./components/TaskAuditSummary";
import { TaskGovernancePanel } from "./components/TaskGovernancePanel";
import { TaskOperations } from "./components/TaskOperations";
import { TaskRuntimeCard } from "./components/TaskRuntimeCard";
import { buildTaskTimeline } from "./taskTimeline";
import "./tasks.css";

const BACK = (
  <Link to="/tasks" className="link ui-inline" style={{ gap: 4 }}>
    <ChevronLeft width={16} height={16} aria-hidden="true" />
    Back to Tasks
  </Link>
);

export function TaskDetailPage() {
  const { taskId } = useParams();
  const taskQuery = useTask(taskId);
  const auditQuery = useAuditEvents({ taskId, limit: 100 });
  const task = taskQuery.data;
  const timeline = useMemo(
    () => (task ? buildTaskTimeline(task, auditQuery.data?.items ?? []) : []),
    [auditQuery.data, task],
  );
  const execution = useMemo(() => {
    if (!task) return null;
    const currentTaskId = task.status === "running" ? task.taskId : undefined;
    return (
      pairExecutions(auditQuery.data?.items ?? [], currentTaskId)[0] ?? null
    );
  }, [auditQuery.data, task]);

  if (taskQuery.isPending) {
    return (
      <PageFrame title="Task" description="Loading task…">
        <Stack gap="lg">
          {BACK}
          <Skeleton height="4rem" />
          <Skeleton height="12rem" />
          <Skeleton height="16rem" />
        </Stack>
      </PageFrame>
    );
  }

  if (taskQuery.isError || !task) {
    const notFound =
      isApiError(taskQuery.error) && taskQuery.error.category === "not_found";
    const forbidden =
      isApiError(taskQuery.error) && taskQuery.error.category === "forbidden";
    return (
      <PageFrame title="Task" description="Task detail">
        <Stack gap="lg">
          {BACK}
          <ErrorState
            variant={
              notFound ? "not-found" : forbidden ? "forbidden" : "network"
            }
            title={
              notFound
                ? "Task not found"
                : forbidden
                  ? "Access restricted"
                  : "Unable to load this task"
            }
            detail={
              notFound
                ? "The requested task does not exist or is no longer available."
                : forbidden
                  ? "You do not have permission to view this task."
                  : "The Control Center could not retrieve this task."
            }
            action={
              !notFound && !forbidden ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void taskQuery.refetch()}
                >
                  Retry
                </Button>
              ) : undefined
            }
          />
        </Stack>
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title={task.description || task.type}
      description={`${task.type} · governed task`}
      actions={<StatusBadge status={task.status} />}
    >
      <Stack gap="lg">
        {BACK}

        {task.lastError ? (
          <Alert tone="danger" title="Latest task error">
            {task.lastError}
          </Alert>
        ) : null}

        <div className="task-detail-grid">
          <Stack gap="lg" className="task-detail-grid__main">
            <Section title="Overview">
              <Card>
                <CardBody>
                  <p className="task-detail__description">{task.description}</p>
                  <KeyValue
                    rows={[
                      {
                        key: "Task ID",
                        value: <Identifier value={task.taskId} />,
                      },
                      { key: "Type", value: task.type },
                      {
                        key: "Status",
                        value: <StatusBadge status={task.status} />,
                      },
                      { key: "Priority", value: task.priority },
                      {
                        key: "Assigned agent",
                        value: task.assignedAgentId ? (
                          <Link
                            to={`/agents/${encodeURIComponent(task.assignedAgentId)}`}
                            className="link"
                          >
                            {task.assignedAgentId}
                          </Link>
                        ) : (
                          "Unassigned"
                        ),
                      },
                      {
                        key: "Project",
                        value: (
                          <Link
                            to={`/projects/${encodeURIComponent(task.projectId)}`}
                            className="link"
                          >
                            {task.projectId}
                          </Link>
                        ),
                      },
                      {
                        key: "Workflow",
                        value: task.workflowId ? (
                          <Link
                            to={`/workflows/${encodeURIComponent(task.workflowId)}`}
                            className="link"
                          >
                            {task.workflowId}
                          </Link>
                        ) : (
                          "Standalone task"
                        ),
                      },
                      { key: "Retry count", value: String(task.retryCount) },
                      {
                        key: "Created",
                        value: <Timestamp value={task.createdAt} />,
                      },
                      {
                        key: "Updated",
                        value: <Timestamp value={task.updatedAt} />,
                      },
                    ]}
                  />
                </CardBody>
              </Card>
            </Section>

            <Section title="Lifecycle">
              <Card>
                <CardBody>
                  {auditQuery.isPending ? (
                    <Stack gap="sm">
                      <Skeleton height="3rem" />
                      <Skeleton height="3rem" />
                    </Stack>
                  ) : auditQuery.isError ? (
                    <Alert
                      tone="warning"
                      title="Timeline temporarily unavailable"
                    >
                      The task remains available, but its audit-backed lifecycle
                      could not be loaded.
                    </Alert>
                  ) : (
                    <TaskLifecycleTimeline entries={timeline} />
                  )}
                </CardBody>
              </Card>
            </Section>

            <Section title="Runtime intelligence">
              <TaskRuntimeCard
                task={task}
                execution={execution}
                isPending={auditQuery.isPending}
                isError={auditQuery.isError}
                error={auditQuery.error}
                onRetry={() => void auditQuery.refetch()}
              />
            </Section>

            <Section title="Governance audit">
              <TaskAuditSummary
                taskId={task.taskId}
                events={auditQuery.data?.items ?? []}
                isPending={auditQuery.isPending}
                isError={auditQuery.isError}
                errorIsForbidden={
                  isApiError(auditQuery.error) &&
                  auditQuery.error.category === "forbidden"
                }
                onRetry={() => void auditQuery.refetch()}
              />
            </Section>
          </Stack>

          <Stack gap="lg" className="task-detail-grid__aside">
            <Section title="Task governance">
              <Stack gap="md">
                <TaskGovernancePanel task={task} />
              </Stack>
            </Section>
            <Section title="Operations">
              <TaskOperations
                task={task}
                onChanged={() =>
                  Promise.all([taskQuery.refetch(), auditQuery.refetch()])
                }
              />
            </Section>
            <Section title="Relationships">
              <Card>
                <CardBody>
                  <KeyValue
                    rows={[
                      {
                        key: "Dependencies",
                        value: task.dependsOn.length
                          ? task.dependsOn.join(", ")
                          : "None",
                      },
                      {
                        key: "Workflow stage",
                        value: task.workflowSpecId ?? "Not applicable",
                      },
                    ]}
                  />
                </CardBody>
              </Card>
            </Section>
            <p className="text-caption">
              Lifecycle events come from the bounded, task-scoped audit feed.
              Full governance details arrive in a later Tasks increment.
            </p>
          </Stack>
        </div>
      </Stack>
    </PageFrame>
  );
}
