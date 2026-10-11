import type { FormEvent, ReactNode } from "react";
import { Button, Dialog } from "../../../components/ui";
import { useTrustCommand } from "../hooks/useTrust";
import { useT } from "../lib/useT";
import type { SecurityCommandName } from "../types";
import { ErrorPanel } from "./common";

interface FormDialogProps {
  title: string;
  submitLabel: string;
  command: SecurityCommandName;
  getBody: () => Record<string, unknown>;
  canSubmit?: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** A form that sends one command; the server's refusal stays visible in the dialog. Mount only while open. */
export function FormDialog({ title, submitLabel, command, getBody, canSubmit = true, onClose, children }: FormDialogProps) {
  const { tt } = useT();
  const mutation = useTrustCommand();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ command, body: getBody() }, { onSuccess: onClose });
  };
  return (
    <Dialog open onClose={onClose} title={title}>
      <form className="sc-form" onSubmit={submit}>
        {children}
        {mutation.isError ? <ErrorPanel error={mutation.error} /> : null}
        <div className="sc-actions">
          <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!canSubmit}>{submitLabel}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>{tt("common.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
