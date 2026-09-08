const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact" });

export function formatCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value < 10_000 ? String(value) : COMPACT.format(value);
}

export function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function percent(fraction: number | null | undefined): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  return `${Math.round(fraction * 100)}%`;
}
