import type { FormEvent, ReactNode } from "react";
import { Button, Dialog } from "../../../components/ui";
import { useCommand } from "../hooks/useCommand";
import { useT } from "../lib/useT";
import type { CommandResult } from "../api/http";
import { ErrorPanel } from "./common";
import { useReport } from "./report";

interface CommandDialogProps {
  title: string;
  description?: ReactNode;
  submitLabel: string;
  command: string;
  getBody: () => Record<string, unknown>;
  canSubmit?: boolean;
  danger?: boolean;
  /** Announced (aria-live) after the server accepted the command. */
  successMessage: string | ((result: CommandResult) => string);
  onClose: () => void;
  children?: ReactNode;
}

/**
 * Explicit confirmation / small form for one command. The server's own refusal text is shown inside the dialog and it
 * stays open; it closes only after the server accepted the command. Mount it only while it is open.
 */
export function CommandDialog({
  title, description, submitLabel, command, getBody, canSubmit = true, danger = false, successMessage, onClose, children,
}: CommandDialogProps) {
  const { tt } = useT();
  const { report } = useReport();
  const mutation = useCommand();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      { command, body: getBody() },
      {
        onSuccess: (result) => {
          report({ tone: "success", message: typeof successMessage === "function" ? successMessage(result) : successMessage });
          onClose();
        },
      },
    );
  };
  return (
    <Dialog open onClose={onClose} title={title}>
      <form className="pc-form" onSubmit={submit}>
        {description ? <div>{description}</div> : null}
        {children}
        {mutation.isError ? <ErrorPanel error={mutation.error} /> : null}
        <div className="pc-actions">
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={mutation.isPending} disabled={!canSubmit}>{submitLabel}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>{tt("common.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
