import { useState } from "react";
import { isApiError } from "../../../api";
import type {
  ControlCommandResult,
  WorkflowView,
} from "../../../api/contracts";
import { useAuth } from "../../../auth/useAuth";
import { useToast } from "../../../components/ui";
import {
  useCancelWorkflow,
  usePauseWorkflow,
  useResumeWorkflow,
} from "../../../features/workflows";
import {
  availableWorkflowActions,
  structuralWorkflowActions,
  workflowActionLabel,
  workflowActionUnavailableReason,
  type WorkflowAction,
} from "../workflowActions";
import { WorkflowActions } from "./WorkflowActions";

function actionFailureMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.category === "unauthenticated") {
      return "Your session has expired. Sign in again to continue.";
    }
    if (error.category === "forbidden") {
      return "You are not authorized to operate this workflow.";
    }
    if (error.category === "conflict" || error.category === "validation") {
      return "The Control Plane did not accept this operation for the workflow's current state. The workflow has been refreshed for review.";
    }
  }
  return "The Control Plane could not complete this operation. Try again later.";
}

function resultWasExecuted(result: ControlCommandResult): boolean {
  return result.ok && result.outcome === "executed";
}

/**
 * The sole workflow-operation controller. It invokes the existing Control
 * Plane hooks and refreshes authoritative detail, runtime, and graph data
 * after each accepted command; it never patches workflow state locally.
 */
export function WorkflowOperations({
  workflow,
  onChanged,
}: {
  workflow: WorkflowView;
  onChanged: () => Promise<unknown>;
}) {
  const { role, allowedProjects } = useAuth();
  const { toast } = useToast();
  const pause = usePauseWorkflow();
  const resume = useResumeWorkflow();
  const cancel = useCancelWorkflow();
  const [pendingAction, setPendingAction] = useState<WorkflowAction | null>(
    null,
  );
  const [errorText, setErrorText] = useState<string | null>(null);

  const actions = availableWorkflowActions(workflow, role, allowedProjects);
  const structural = structuralWorkflowActions(workflow);
  const unavailableAction =
    actions.length === 0 ? (structural[0] ?? null) : null;
  const unavailableReason = unavailableAction
    ? workflowActionUnavailableReason(
        workflow,
        unavailableAction,
        role,
        allowedProjects,
      )
    : null;

  async function onAction(
    action: WorkflowAction,
    reason: string | undefined,
  ): Promise<boolean> {
    if (pendingAction) return false;
    setErrorText(null);
    setPendingAction(action);
    try {
      const mutate =
        action === "pause" ? pause : action === "resume" ? resume : cancel;
      const result = await mutate.mutateAsync({
        workflowId: workflow.workflowId,
        reason,
      });
      await onChanged();
      if (!resultWasExecuted(result)) {
        setErrorText(
          "The Control Plane did not accept this operation. The workflow remains authoritative.",
        );
        return false;
      }
      toast({
        tone: "success",
        title: `${workflowActionLabel(action)} requested`,
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
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <WorkflowActions
      workflow={workflow}
      actions={actions}
      unavailableAction={unavailableAction}
      unavailableReason={unavailableReason}
      pendingAction={pendingAction}
      errorText={errorText}
      onAction={onAction}
    />
  );
}
