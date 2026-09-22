import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useTask } from "../../features/tasks";
import { TaskDetailHeader } from "./components/TaskDetailHeader";
import { TaskOverviewCard } from "./components/TaskOverviewCard";
import { TaskContextCard } from "./components/TaskContextCard";
import { TaskTimeline } from "./components/TaskTimeline";
import { TaskExecutionSummary } from "./components/TaskExecutionSummary";
import { TaskErrorState } from "./components/TaskErrorState";
import { TaskLoadingState } from "./components/TaskLoadingState";
import "./TasksPage.css";

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { data: task, status, refetch } = useTask(taskId);

  if (status === "loading") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="AI Workforce"
          title="Task Detail"
          description="Inspect task parameters, context, lifecycle events, and execution summary."
        />
        <TaskLoadingState />
      </PageContainer>
    );
  }

  if (status === "not_found" || !task) {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="AI Workforce"
          title="Task Detail"
          description="Inspect task parameters, context, lifecycle events, and execution summary."
        />
        <div className="task-not-found">
          <h2>Task Not Found</h2>
          <p>
            The task with ID <code>{taskId}</code> could not be found in the Control Plane or may have been removed.
          </p>
          <Link to="/tasks" className="ui-button primary">
            <ArrowLeft size={16} style={{ marginRight: 8 }} aria-hidden />
            Back to Tasks
          </Link>
        </div>
      </PageContainer>
    );
  }

  if (status === "error" || status === "unauthorized" || status === "degraded") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="AI Workforce"
          title="Task Detail"
          description="Inspect task parameters, context, lifecycle events, and execution summary."
        />
        <TaskErrorState
          title={status === "unauthorized" ? "Unauthorized" : "Unable to load task detail"}
          description={
            status === "unauthorized"
              ? "You do not have permission to view details for this task."
              : "Failed to retrieve task information from the Control Plane."
          }
          onRetry={refetch}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="AI Workforce"
        title="Task Detail"
        description="Inspect task parameters, context, lifecycle events, and execution summary."
      />

      <div className="task-detail-page">
        <TaskDetailHeader
          taskId={task.id}
          title={task.title}
          status={task.status}
          priority={task.priority}
        />

        <div className="task-detail-grid">
          <div className="task-detail-column">
            <TaskOverviewCard
              description={task.description}
              type={task.type}
              createdAt={task.createdAt}
              updatedAt={task.updatedAt}
              startedAt={task.startedAt}
              completedAt={task.completedAt}
              dueAt={task.dueAt}
            />

            <TaskContextCard
              agentId={task.agentId}
              agentName={task.agentName}
              projectId={task.projectId}
              projectName={task.projectName}
              workflowId={task.workflowId}
              workflowName={task.workflowName}
            />
          </div>

          <div className="task-detail-column">
            <TaskTimeline timeline={task.timeline} />

            <TaskExecutionSummary executionSummary={task.executionSummary} />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

