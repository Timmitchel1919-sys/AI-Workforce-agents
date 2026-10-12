import { useState, type ReactNode } from "react";
import { Button, Dialog, Textarea } from "../../../components/ui";
import { useT } from "../lib/useT";
import { ErrorPanel } from "./common";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  error?: unknown;
  /** When set, an optional free-text field is shown and passed to `onConfirm`. */
  noteLabel?: string;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

/** Explicit confirmation for anything that changes or removes knowledge. Nothing is ever picked automatically. */
export function ConfirmDialog({ open, title, description, confirmLabel, danger = false, pending = false, error, noteLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const { tt } = useT();
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <div className="kn-stack">
        <div>{description}</div>
        {noteLabel ? <Textarea label={noteLabel} value={note} rows={2} onChange={(event) => setNote(event.target.value)} /> : null}
        {error ? <ErrorPanel error={error} /> : null}
        <div className="kn-actions">
          <Button type="button" variant={danger ? "danger" : "primary"} loading={pending} onClick={() => onConfirm(note.trim())}>{confirmLabel}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>{tt("common.cancel")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
