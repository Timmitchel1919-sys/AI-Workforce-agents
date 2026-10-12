import { useState, type ReactNode } from "react";
import { Button, Dialog, Textarea } from "../../../components/ui";
import { useTrustCommand } from "../hooks/useTrust";
import { useT } from "../lib/useT";
import type { SecurityCommandName } from "../types";
import { ErrorPanel } from "./common";

interface CommandDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  command: SecurityCommandName;
  /** Builds the command body from the (trimmed) note. */
  buildBody: (note: string) => Record<string, unknown>;
  danger?: boolean;
  noteLabel?: string;
  noteRequired?: boolean;
  onClose: () => void;
}

/**
 * Explicit confirmation for a security command. The server's own refusal text is shown in the dialog and the dialog
 * stays open; it closes only after the server accepted the command. Mount it only while it is open.
 */
export function CommandDialog({ title, description, confirmLabel, command, buildBody, danger = false, noteLabel, noteRequired = false, onClose }: CommandDialogProps) {
  const { tt } = useT();
  const [note, setNote] = useState("");
  const mutation = useTrustCommand();
  const trimmed = note.trim();
  const blocked = noteRequired && trimmed.length === 0;
  return (
    <Dialog open onClose={onClose} title={title}>
      <div className="sc-stack">
        <div>{description}</div>
        {noteLabel ? <Textarea label={noteLabel} value={note} rows={3} required={noteRequired} onChange={(event) => setNote(event.target.value)} /> : null}
        {mutation.isError ? <ErrorPanel error={mutation.error} /> : null}
        <div className="sc-actions">
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            loading={mutation.isPending}
            disabled={blocked}
            onClick={() => mutation.mutate({ command, body: buildBody(trimmed) }, { onSuccess: onClose })}
          >
            {confirmLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>{tt("common.cancel")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
