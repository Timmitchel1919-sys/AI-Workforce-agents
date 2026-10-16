/**
 * UI Layer 10 — local, deterministic data analysis. Pure functions over data
 * the owner selected in the browser; nothing is uploaded. Missing values are
 * never counted as zero, and every statistic carries its sample size.
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 200;
const MISSING = new Set(["", "na", "n/a", "null", "nan", "none", "-"]);

export interface Table {
  columns: string[];
  rows: string[][];
  truncated: boolean;
}

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseCsv(text: string): Table {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS) {
        truncated = true;
        break;
      }
    } else field += ch;
  }
  if (!truncated && (field !== "" || row.length)) {
    row.push(field);
    rows.push(row);
  }
  const header = (rows.shift() ?? []).slice(0, MAX_COLUMNS).map((h, i) => h.trim() || `column_${i + 1}`);
  const body = rows.slice(0, MAX_ROWS).map((r) => header.map((_, i) => r[i] ?? ""));
  return { columns: header, rows: body, truncated: truncated || rows.length > MAX_ROWS };
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

export function isMissing(value: string): boolean {
  return MISSING.has(value.trim().toLowerCase());
}

/** Accepts "1,234.5", "1.234,5" is NOT guessed (ambiguous): only plain or thousands-comma. */
export function toNumber(value: string): number | null {
  const v = value.trim().replace(/^\$/, "");
  if (!/^-?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export type ColumnType = "number" | "date" | "text" | "empty";

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  count: number;
  missing: number;
  unique: number;
  /** numeric columns only */
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  std?: number;
  /** values that looked non-numeric in a numeric column */
  invalid: number;
  top: { value: string; count: number }[];
}

export function profileColumn(name: string, values: string[]): ColumnProfile {
  const present = values.filter((v) => !isMissing(v));
  const nums = present.map(toNumber);
  const numeric = nums.filter((n): n is number => n !== null);
  const dates = present.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)));
  const type: ColumnType =
    present.length === 0
      ? "empty"
      : numeric.length / present.length >= 0.9
        ? "number"
        : dates.length / present.length >= 0.9
          ? "date"
          : "text";
  const freq = new Map<string, number>();
  for (const v of present) freq.set(v, (freq.get(v) ?? 0) + 1);
  const profile: ColumnProfile = {
    name,
    type,
    count: values.length,
    missing: values.length - present.length,
    unique: freq.size,
    invalid: type === "number" ? present.length - numeric.length : 0,
    top: [...freq].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([value, count]) => ({ value, count })),
  };
  if (type === "number" && numeric.length) {
    const sorted = [...numeric].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((s, x) => s + x, 0) / n;
    profile.min = sorted[0];
    profile.max = sorted[n - 1];
    profile.mean = mean;
    profile.median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
    // Sample standard deviation (n-1); undefined for a single observation.
    profile.std = n > 1 ? Math.sqrt(sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : undefined;
  }
  return profile;
}

export function profileTable(table: Table): ColumnProfile[] {
  return table.columns.map((c, i) => profileColumn(c, table.rows.map((r) => r[i] ?? "")));
}

/** Pearson correlation over rows where BOTH values are present and numeric. */
export function correlation(table: Table, a: number, b: number): { r: number | null; n: number } {
  const pairs: [number, number][] = [];
  for (const row of table.rows) {
    const x = toNumber(row[a] ?? "");
    const y = toNumber(row[b] ?? "");
    if (x !== null && y !== null && !isMissing(row[a]!) && !isMissing(row[b]!)) pairs.push([x, y]);
  }
  const n = pairs.length;
  if (n < 3) return { r: null, n };
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, n };
}

/** Sum of a numeric column grouped by a category column; missing values excluded and counted. */
export function groupSum(table: Table, groupCol: number, valueCol: number) {
  const sums = new Map<string, { sum: number; n: number }>();
  let skipped = 0;
  for (const row of table.rows) {
    const g = row[groupCol] ?? "";
    const v = toNumber(row[valueCol] ?? "");
    if (isMissing(g) || v === null) {
      skipped += 1;
      continue;
    }
    const cur = sums.get(g) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    sums.set(g, cur);
  }
  return {
    groups: [...sums].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.sum - a.sum),
    skipped,
  };
}

/** CSV cell safe against spreadsheet formula injection (OWASP CSV injection). */
export function safeCsvCell(value: string | number | undefined): string {
  let s = value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function profilesToCsv(profiles: ColumnProfile[]): string {
  const head = ["column", "type", "count", "missing", "unique", "invalid", "min", "max", "mean", "median", "std"];
  const lines = profiles.map((p) =>
    [p.name, p.type, p.count, p.missing, p.unique, p.invalid, p.min, p.max, p.mean, p.median, p.std].map((v) => safeCsvCell(v)).join(","),
  );
  return [head.join(","), ...lines].join("\r\n");
}
