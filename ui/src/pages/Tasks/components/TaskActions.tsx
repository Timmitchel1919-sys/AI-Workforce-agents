import { useState } from "react";
import type { TaskView } from "../../../api/contracts";
import {
  Alert,
  Button,
  Dialog,
  Field,
  Textarea,
  Tooltip,
} from "../../../components/ui";
import { Ban, RefreshCw, type LucideIcon } from "../../../components/ui/icons";
import {
  taskActionConsequence,
  taskActionDialogTitle,
  taskActionLabel,
  type TaskAction,
} from "../taskActions";

const ACTION_ICON: Record<TaskAction, LucideIcon> = {
  cancel: Ban,
  retry: RefreshCw,
};

/**
 * Presentational governed task controls. It owns only local dialog form state;
 * all operations are emitted through `onAction` and contain no API, Firebase,
 * cache, or Task mutation logic.
 */
export function TaskActions({
  task,
  actions,
  unavailableAction,
  unavailableReason,
  pendingAction,
  errorText,
  onAction,
}: {
  task: TaskView;
  actions: readonly TaskAction[];
  unavailableAction: TaskAction | null;
  unavailableReason: string | null;
  pendingAction: TaskAction | null;
  errorText: string | null;
  onAction: (
    action: TaskAction,
    reason: string | undefined,
  ) => Promise<boolean>;
}) {
  const [selectedAction, setSelectedAction] = useState<TaskAction | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const isSubmitting = confirming || pendingAction !== null;

  function openDialog(action: TaskAction) {
    if (isSubmitting) return;
    setSelectedAction(action);
    setReason("");
  }

  function closeDialog() {
    if (isSubmitting) return;
    setSelectedAction(null);
    setReason("");
  }

  async function confirm() {
    if (!selectedAction || isSubmitting) return;
    setConfirming(true);
    const succeeded = await onAction(
      selectedAction,
      reason.trim() || undefined,
    );
    setConfirming(false);
    if (succeeded) closeDialog();
  }

  if (actions.length === 0 && unavailableAction === null) {
    return (
      <p className="text-caption">
        No supported lifecycle operation is available for this task's current
        status.
      </p>
    );
  }

  if (actions.length === 0 && unavailableAction) {
    const Icon = ACTION_ICON[unavailableAction];
    return (
      <Tooltip content={unavailableReason ?? "This action is not available."}>
        <Button
          variant="outline"
          size="sm"
          iconLeft={Icon}
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
        >
          {taskActionLabel(unavailableAction)}
        </Button>
      </Tooltip>
    );
  }

  // The real operation matrix allows only one action for any given Task state,
  // so a single visible control is clearer than a redundant More menu.
  const primary = actions[0]!;
  const Icon = ACTION_ICON[primary];

  return (
    <>
      <Button
        variant={primary === "cancel" ? "danger" : "primary"}
        size="sm"
        iconLeft={Icon}
        onClick={() => openDialog(primary)}
        disabled={isSubmitting}
      >
        {taskActionLabel(primary)}
      </Button>

      <Dialog
        open={selectedAction !== null}
        onClose={closeDialog}
        title={
          selectedAction ? taskActionDialogTitle(selectedAction, task) : ""
        }
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={closeDialog}
              disabled={isSubmitting}
            >
              Keep task unchanged
            </Button>
            <Button
              variant={selectedAction === "cancel" ? "danger" : "primary"}
              size="sm"
              loading={isSubmitting}
              disabled={isSubmitting}
              onClick={() => void confirm()}
            >
              {selectedAction ? taskActionLabel(selectedAction) : ""}
            </Button>
          </>
        }
      >
        <p className="text-body-sm">
          {selectedAction ? taskActionConsequence(selectedAction, task) : ""}
        </p>
        <Field label="Reason (optional)" htmlFor="task-action-reason">
          <Textarea
            id="task-action-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Recorded in the audit trail"
            disabled={isSubmitting}
          />
        </Field>
        {errorText ? (
          <Alert tone="danger" title="The command did not run">
            {errorText}
          </Alert>
        ) : null}
      </Dialog>
    </>
  );
}
