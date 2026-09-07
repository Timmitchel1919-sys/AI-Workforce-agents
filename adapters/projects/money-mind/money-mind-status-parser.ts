/**
 * Tiny, pure, forgiving parsers for the two structured files the adapter
 * reads for `READ_STATUS` / `READ_CONFIGURATION`. Deliberately not a general
 * YAML parser (no new dependency) — it recognizes exactly the
 * `chapter-registry`-style shape this project's status doc uses and ignores
 * everything else.
 */
import type { MoneyMindChapterStatus } from "../../../contracts/index.js";

export function parseMoneyMindChapterRegistry(
  yaml: string,
): MoneyMindChapterStatus[] {
  const chapters: MoneyMindChapterStatus[] = [];
  let current: Partial<MoneyMindChapterStatus> | null = null;

  const flush = (): void => {
    if (current && typeof current.number === "number") {
      chapters.push({
        number: current.number,
        title: current.title ?? "",
        implementationStatus: current.implementationStatus ?? "unknown",
        validationStatus: current.validationStatus ?? "unknown",
      });
    }
  };

  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    const numberMatch = /^-\s*number:\s*(\d+)/.exec(line);
    if (numberMatch) {
      flush();
      current = { number: Number(numberMatch[1]) };
      continue;
    }
    if (!current) continue;
    const titleMatch = /^title:\s*(.+)$/.exec(line);
    if (titleMatch) {
      current.title = titleMatch[1].trim();
      continue;
    }
    const implMatch = /^implementationStatus:\s*(.+)$/.exec(line);
    if (implMatch) {
      current.implementationStatus = implMatch[1].trim();
      continue;
    }
    const valMatch = /^validationStatus:\s*(.+)$/.exec(line);
    if (valMatch) {
      current.validationStatus = valMatch[1].trim();
      continue;
    }
  }
  flush();
  return chapters;
}

/** Extract `NAME=value` keys from an env-file-style document (e.g. `.env.example`). */
export function parseMoneyMindFeatureFlagNames(text: string): string[] {
  const names: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match) names.push(match[1]!);
  }
  return names;
}
