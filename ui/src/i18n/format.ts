import { en } from "./locales/en";
import type { Language } from "./languages";
import type { MessageKey, MessageParams } from "./messages";

type Translate = (key: MessageKey, params?: MessageParams) => string;

const LOCALE_TAGS: Record<Language, string> = { en: "en-GB", nl: "nl-NL" };

/** Date/time in the interface language (not the browser's), or the raw value if unparsable. */
export function formatDateTime(value: string | undefined | null, language: Language): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(LOCALE_TAGS[language]);
}

const STATUS_KEYS = new Set(Object.keys(en.status));
const PRIORITY_KEYS = new Set(Object.keys(en.priority));

/** Status labels from the API: translated when known, otherwise shown as-is (never dropped). */
export function translateStatus(t: Translate, value: string): string {
  return STATUS_KEYS.has(value) ? t(`status.${value}` as MessageKey) : value.replace(/_/g, " ");
}

export function translatePriority(t: Translate, value: string): string {
  return PRIORITY_KEYS.has(value) ? t(`priority.${value}` as MessageKey) : value;
}
