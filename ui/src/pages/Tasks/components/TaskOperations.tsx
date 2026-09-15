import { useState } from "react";
import { isApiError } from "../../../api";
import type { ControlCommandResult, TaskView } from "../../../api/contracts";
import { useAuth } from "../../../auth/useAuth";
import { useTaskActions } from "../../../features/tasks";
import { useToast } from "../../../components/ui";
import {
  availableTaskActions,
  structuralTaskAction,
  taskActionLabel,
  taskActionUnavailableReason,
  type TaskAction,
} from "../taskActions";
import { TaskActions } from "./TaskActions";

function actionFailureMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.category === "unauthenticated") {
      return "Your session has expired. Sign in again to continue.";
    }
    if (error.category === "forbidden") {
      return "You are not authorized to perform this action.";
    }
    if (error.category === "conflict" || error.category === "validation") {
      return "The Control Plane did not accept this operation for the task's current state. The task has been refreshed for review.";
    }
  }
  return "The Control Plane could not complete this operation. Try again later.";
}

function resultWasExecuted(result: ControlCommandResult): boolean {
  return result.ok && result.outcome === "executed";
}

/**
 * Task operation controller:
 * TaskActions â†’ useTaskActions â†’ Control Plane â†’ invalidation/refetch.
 * It is intentionally the only Task UI layer aware of mutations.
 */
export function TaskOperations({
  task,
  onChanged,
}: {
  task: TaskView;
  onChanged: () => Promise<unknown>;
}) {
  const { role, allowedProjects } = useAuth();
  const { toast } = useToast();
  const { execute, status } = useTaskActions();
  const [errorText, setErrorText] = useState<string | null>(null);

  const actions = availableTaskActions(task, role, allowedProjects);
  const unavailableAction =
    actions.length === 0 ? structuralTaskAction(task) : null;
  const unavailableReason = unavailableAction
    ? taskActionUnavailableReason(
        task,
        unavailableAction,
        role,
        allowedProjects,
      )
    : null;
  const pendingAction =
    status === "pending" ? (unavailableAction ?? actions[0] ?? null) : null;

  async function onAction(
    action: TaskAction,
    reason: string | undefined,
  ): Promise<boolean> {
    setErrorText(null);
    try {
      const result = await execute(action, { taskId: task.taskId, reason });
      if (!resultWasExecuted(result)) {
        setErrorText(
          "The Control Plane did not accept this operation. The task remains unchanged.",
        );
        await onChanged();
        return false;
      }
      await onChanged();
      toast({
        tone: "success",
        title: `${taskActionLabel(action)} requested`,
        detail: result.reason,
      });
      return true;
    } catch (error) {
      if (
        isApiError(error) &&
        (error.category === "conflict" || error.category === "validation")
      ) {
        await onChanged();
      }
      setErrorText(actionFailureMessage(error));
      return false;
    }
  }

  return (
    <TaskActions
      task={task}
      actions={actions}
      unavailableAction={unavailableAction}
      unavailableReason={unavailableReason}
      pendingAction={pendingAction}
      errorText={errorText}
      onAction={onAction}
    />
  );
}
