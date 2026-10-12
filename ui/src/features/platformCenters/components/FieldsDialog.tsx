import { useState, type ReactNode } from "react";
import { Checkbox, Input, Select, Textarea } from "../../../components/ui";
import { CommandDialog } from "./CommandDialog";

export interface FieldSpec {
  key: string;
  label: string;
  type?: "text" | "number" | "textarea" | "select" | "checkbox" | "lines" | "pairs";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
}

interface Props {
  title: string;
  description?: ReactNode;
  submitLabel: string;
  command: string;
  fields: FieldSpec[];
  /** Always-sent body fields (ids of the thing being changed). */
  fixed?: Record<string, unknown>;
  initial?: Record<string, string>;
  /** Nest the form values under this key in the body (for commands that take e.g. `replacement`). */
  nestUnder?: string;
  danger?: boolean;
  successMessage: string;
  onClose: () => void;
}

/**
 * A small form for one command. Blank optional fields are omitted, numbers are coerced, `lines` fields become string
 * arrays (one per line). The server's own refusal text is shown inside the dialog by CommandDialog.
 */
export function FieldsDialog({ title, description, submitLabel, command, fields, fixed = {}, initial = {}, nestUnder, danger, successMessage, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of fields) out[f.key] = initial[f.key] ?? (f.type === "select" ? (f.options?.[0]?.value ?? "") : f.type === "checkbox" ? "false" : "");
    return out;
  });
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const canSubmit = fields.every((f) => !f.required || (values[f.key] ?? "").trim() !== "");
  const getBody = (): Record<string, unknown> => {
    const form: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = (values[f.key] ?? "").trim();
      if (f.type === "checkbox") form[f.key] = raw === "true";
      else if (raw === "") continue;
      else if (f.type === "number") form[f.key] = Number(raw);
      else if (f.type === "pairs") {
        const obj: Record<string, string> = {};
        for (const line of raw.split("\n")) {
          const at = line.indexOf("=");
          if (at > 0) obj[line.slice(0, at).trim()] = line.slice(at + 1).trim();
        }
        form[f.key] = obj;
      } else if (f.type === "lines") form[f.key] = raw.split("\n").map((s) => s.trim()).filter(Boolean);
      else form[f.key] = raw;
    }
    return nestUnder ? { ...fixed, [nestUnder]: form } : { ...fixed, ...form };
  };
  return (
    <CommandDialog
      title={title}
      {...(description ? { description } : {})}
      submitLabel={submitLabel}
      command={command}
      getBody={getBody}
      canSubmit={canSubmit}
      {...(danger ? { danger } : {})}
      successMessage={successMessage}
      onClose={onClose}
    >
      {fields.map((f) =>
        f.type === "textarea" || f.type === "lines" || f.type === "pairs" ? (
          <Textarea key={f.key} label={f.label} rows={4} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} {...(f.placeholder ? { placeholder: f.placeholder } : {})} {...(f.help ? { description: f.help } : {})} />
        ) : f.type === "select" ? (
          <Select key={f.key} label={f.label} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : f.type === "checkbox" ? (
          <Checkbox key={f.key} label={f.label} checked={values[f.key] === "true"} onChange={(e) => set(f.key, e.target.checked ? "true" : "false")} />
        ) : (
          <Input key={f.key} label={f.label} type={f.type === "number" ? "number" : "text"} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} {...(f.placeholder ? { placeholder: f.placeholder } : {})} {...(f.help ? { description: f.help } : {})} />
        ),
      )}
    </CommandDialog>
  );
}
