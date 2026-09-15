import { useState } from "react";
import type { WorkflowView } from "../../../api/contracts";
import { Alert, Button, Dropdown, Tooltip } from "../../../components/ui";
import {
  Ban,
  ChevronDown,
  Pause,
  Play,
  type LucideIcon,
} from "../../../components/ui/icons";
import { workflowActionLabel, type WorkflowAction } from "../workflowActions";
import { WorkflowActionDialog } from "./WorkflowActionDialog";

const ACTION_ICON: Record<WorkflowAction, LucideIcon> = {
  pause: Pause,
  resume: Play,
  cancel: Ban,
};

/**
 * Presentational workflow controls. This component contains no API, cache,
 * Firebase, or command-client calls; it emits typed requests to its parent.
 */
export function WorkflowActions({
  workflow,
  actions,
  unavailableAction,
  unavailableReason,
  pendingAction,
  errorText,
  onAction,
}: {
  workflow: WorkflowView;
  actions: readonly WorkflowAction[];
  unavailableAction: WorkflowAction | null;
  unavailableReason: string | null;
  pendingAction: WorkflowAction | null;
  errorText: string | null;
  onAction: (
    action: WorkflowAction,
    reason: string | undefined,
  ) => Promise<boolean>;
}) {
  const [selectedAction, setSelectedAction] = useState<WorkflowAction | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const isSubmitting = confirming || pendingAction !== null;

  function openDialog(action: WorkflowAction) {
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
        No supported lifecycle operation is available for this workflow's
        current status.
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
          {workflowActionLabel(unavailableAction)}
        </Button>
      </Tooltip>
    );
  }

  const primary = actions.find((action) => action !== "cancel") ?? actions[0]!;
  const secondary = actions.filter((action) => action !== primary);
  const PrimaryIcon = ACTION_ICON[primary];

  return (
    <>
      <div className="ui-inline" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button
          variant={primary === "cancel" ? "danger" : "primary"}
          size="sm"
          iconLeft={PrimaryIcon}
          onClick={() => openDialog(primary)}
          disabled={isSubmitting}
        >
          {workflowActionLabel(primary)}
        </Button>
        {secondary.length > 0 ? (
          <Dropdown
            label="More workflow actions"
            trigger={(props) => (
              <Button
                variant="outline"
                size="sm"
                iconRight={ChevronDown}
                disabled={isSubmitting}
                {...props}
              >
                More actions
              </Button>
            )}
            items={secondary.map((action) => ({
              id: action,
              label: workflowActionLabel(action),
              danger: action === "cancel",
              disabled: isSubmitting,
              onSelect: () => openDialog(action),
            }))}
          />
        ) : null}
      </div>
      {errorText ? (
        <Alert tone="danger" title="Workflow operation failed">
          {errorText}
        </Alert>
      ) : null}
      <WorkflowActionDialog
        workflow={workflow}
        action={selectedAction}
        open={selectedAction !== null}
        reason={reason}
        errorText={errorText}
        isSubmitting={isSubmitting}
        onReasonChange={setReason}
        onClose={closeDialog}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
