/**
 * The one place timestamps are parsed/formatted. The Control Plane returns
 * ISO-8601 strings; normalize at this boundary, never with ad-hoc `new Date()`
 * in components. The raw ISO string is kept for technical detail views.
 */

export interface ParsedTimestamp {
  /** The original string, verbatim. */
  raw: string;
  /** Epoch ms, or `null` if unparseable. */
  epochMs: number | null;
  date: Date | null;
  valid: boolean;
}

export function parseTimestamp(
  value: string | null | undefined,
): ParsedTimestamp {
  const raw = value ?? "";
  if (!raw) return { raw, epochMs: null, date: null, valid: false };
  const date = new Date(raw);
  const epochMs = date.getTime();
  if (Number.isNaN(epochMs)) {
    return { raw, epochMs: null, date: null, valid: false };
  }
  return { raw, epochMs, date, valid: true };
}

export function isValidTimestamp(value: string | null | undefined): boolean {
  return parseTimestamp(value).valid;
}

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatTimestamp(value: string | null | undefined): string {
  const parsed = parseTimestamp(value);
  return parsed.date ? DATE_TIME.format(parsed.date) : "—";
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
];

export function formatRelativeTime(
  value: string | null | undefined,
  now: number = Date.now(),
): string {
  const parsed = parseTimestamp(value);
  if (parsed.epochMs === null) return "—";
  const diff = parsed.epochMs - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === "second") {
      return RELATIVE.format(Math.round(diff / ms), unit);
    }
  }
  return "just now";
}

/* Back-compat aliases for the UI-2 names. */
export {
  formatTimestamp as formatDateTime,
  formatRelativeTime as formatRelative,
};
