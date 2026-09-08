/**
 * Secret redaction for everything the Control Plane returns to an operator.
 *
 * The Control Plane surfaces audit data, task metadata, approval metadata, and
 * tool metadata. None of it should ever carry a credential, but the redactor is
 * defence in depth: any key that looks secret is replaced, any long string is
 * truncated, and deep structures are bounded so a whole task context can never
 * be dumped into a view.
 */
const SECRET_KEY =
  /(api[_-]?key|secret|token|password|passwd|authorization|auth[_-]?header|bearer|credential|private[_-]?key|access[_-]?key|client[_-]?secret|session)/i;
const SECRET_VALUE =
  /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;

export const REDACTED = "[redacted]";

const MAX_STRING = 500;
const MAX_ARRAY = 50;
const MAX_KEYS = 60;
const MAX_DEPTH = 4;

function redactString(value: string): string {
  if (SECRET_VALUE.test(value)) return REDACTED;
  return value.length > MAX_STRING
    ? `${value.slice(0, MAX_STRING)}… (${value.length} chars)`
    : value;
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";

  if (Array.isArray(value)) {
    const out = value
      .slice(0, MAX_ARRAY)
      .map((entry) => redactValue(entry, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`… (${value.length} items)`);
    return out;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, entry] of Object.entries(value)) {
      if (count >= MAX_KEYS) {
        out["…"] = `(${Object.keys(value).length} keys)`;
        break;
      }
      count += 1;
      out[key] = SECRET_KEY.test(key)
        ? REDACTED
        : redactValue(entry, depth + 1);
    }
    return out;
  }

  return "[unserializable]";
}

/** Redact + bound an arbitrary structured object (audit `data`, metadata, ...). */
export function redact(data: Record<string, unknown>): Record<string, unknown> {
  return redactValue(data ?? {}, 0) as Record<string, unknown>;
}

/** Redact a single string that may carry a secret (e.g. an error message). */
export function redactText(text: string): string {
  return redactString(text ?? "");
}

/** The (non-sensitive) top-level key names of an object, for a "shape" view. */
export function keyNames(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter((k) => !SECRET_KEY.test(k));
}
