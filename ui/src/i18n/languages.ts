/**
 * Supported interface languages. Adding a language = add its code here, add a
 * locale file under ./locales, and register it in ./messages.ts.
 */
export const SUPPORTED_LANGUAGES = ["en", "nl"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Shown in the language selector in the language's own name (not a flag). */
export const LANGUAGE_NATIVE_NAMES: Record<Language, string> = {
  en: "English",
  nl: "Nederlands",
};

export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_STORAGE_KEY = "ai-workforce-language";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Saved preference → browser locale (if supported) → English. Never geolocation. */
export function detectLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage unavailable — fall through to the browser locale.
  }
  const candidates = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const locale of candidates) {
    const base = locale?.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}
