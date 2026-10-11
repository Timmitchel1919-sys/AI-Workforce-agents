import type { FormEvent, ReactNode } from "react";
import { Button, Dialog } from "../../../components/ui";
import { useIntegrationCommand } from "../hooks/useIntegrations";
import { useT } from "../lib/useT";
import type { IntegrationCommandName } from "../types";
import { ErrorPanel } from "./common";
import { useReport } from "./report";

interface CommandDialogProps {
  title: string;
  description?: ReactNode;
  submitLabel: string;
  command: IntegrationCommandName;
  getBody: () => Record<string, unknown>;
  canSubmit?: boolean;
  danger?: boolean;
  /** Announced (aria-live) after the server accepted the command. */
  successMessage: string;
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
  const mutation = useIntegrationCommand();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      { command, body: getBody() },
      { onSuccess: () => { report({ tone: "success", message: successMessage }); onClose(); } },
    );
  };
  return (
    <Dialog open onClose={onClose} title={title}>
      <form className="ic-form" onSubmit={submit}>
        {description ? <div>{description}</div> : null}
        {children}
        {mutation.isError ? <ErrorPanel error={mutation.error} /> : null}
        <div className="ic-actions">
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={mutation.isPending} disabled={!canSubmit}>{submitLabel}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>{tt("common.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
