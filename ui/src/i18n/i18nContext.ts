import { createContext, useContext } from "react";
import type { Language } from "./languages";
import { translate, type MessageKey, type MessageParams } from "./messages";

export interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
}

// Outside a provider (isolated component tests) the UI still renders in English.
const fallback: I18nContextValue = {
  language: "en",
  setLanguage: () => {},
  t: (key, params) => translate("en", key, params),
};

export const I18nContext = createContext<I18nContextValue>(fallback);

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
