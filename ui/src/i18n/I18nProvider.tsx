import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nContext, type I18nContextValue } from "./i18nContext";
import { LANGUAGE_STORAGE_KEY, detectLanguage, isLanguage, type Language } from "./languages";
import { translate } from "./messages";

export function I18nProvider({ children, initialLanguage }: { children: ReactNode; initialLanguage?: Language }) {
  const [language, setLanguageState] = useState<Language>(() => initialLanguage ?? detectLanguage());

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Preference just won't persist (private mode etc.).
    }
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    // Allowlist: preference values can never inject arbitrary content.
    if (isLanguage(next)) setLanguageState(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => translate(language, key, params),
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export default I18nProvider;
