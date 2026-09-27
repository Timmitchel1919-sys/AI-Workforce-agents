import type { MessageKey } from "../../../i18n";
import type { Translate } from "./labels";

const KNOWN = ["sessions", "changeSets", "verifications", "sourceControl", "releases"] as const;

/** "changeSets,releases" -> "ChangeSets, deployments" (translated); an unknown id is shown readably, not as a key. */
export function sourceNames(t: Translate, csv: string | readonly string[]): string {
  const ids = typeof csv === "string" ? csv.split(",") : csv;
  return ids
    .filter((id) => id !== "")
    .map((id) => ((KNOWN as readonly string[]).includes(id) ? t(`spatial.sources.${id}` as MessageKey) : humanize(id)))
    .join(", ");
}

/** Raw enum-ish values ("timed_out") read as words. */
export function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").trim();
}
