import type { WorkflowView } from "../../../api/contracts";
import { Alert, Button, Dialog, Field, Textarea } from "../../../components/ui";
import {
  workflowActionConsequence,
  workflowActionDialogTitle,
  workflowActionLabel,
  type WorkflowAction,
} from "../workflowActions";

/** Confirmation form only. Commands remain owned by WorkflowOperations. */
export function WorkflowActionDialog({
  workflow,
  action,
  open,
  reason,
  errorText,
  isSubmitting,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  workflow: WorkflowView;
  action: WorkflowAction | null;
  open: boolean;
  reason: string;
  errorText: string | null;
  isSubmitting: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isCancel = action === "cancel";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={action ? workflowActionDialogTitle(action, workflow) : ""}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Keep workflow unchanged
          </Button>
          <Button
            variant={isCancel ? "danger" : "primary"}
            size="sm"
            loading={isSubmitting}
            disabled={isSubmitting}
            onClick={onConfirm}
          >
            {action ? workflowActionLabel(action) : ""}
          </Button>
        </>
      }
    >
      <p className="text-body-sm">
        {action ? workflowActionConsequence(action, workflow) : ""}
      </p>
      <Field label="Reason (optional)" htmlFor="workflow-action-reason">
        <Textarea
          id="workflow-action-reason"
          rows={3}
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
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
  );
}
