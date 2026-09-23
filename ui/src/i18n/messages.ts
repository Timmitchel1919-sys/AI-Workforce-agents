import { en } from "./locales/en";
import { nl } from "./locales/nl";
import type { Language } from "./languages";

/** Every locale must provide the same shape as English (enforced at compile time). */
type DeepStrings<T> = { [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> };
export type Messages = DeepStrings<typeof en>;

type Join<P extends string, K extends string> = P extends "" ? K : `${P}.${K}`;
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? Join<P, K> : Paths<T[K], Join<P, K>>;
}[keyof T & string];

/** Dotted key into the English catalogue, e.g. "nav.overview". */
export type MessageKey = Paths<typeof en>;
export type MessageParams = Record<string, string | number>;

const catalogues: Record<Language, Messages> = { en, nl };

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Controlled fallback: active language → English → the key itself (so a
 * missing entry is visible in QA but never crashes the UI).
 */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const template = lookup(catalogues[language], key) ?? lookup(catalogues.en, key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export { catalogues };
