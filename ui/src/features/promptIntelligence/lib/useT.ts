import { useCallback } from "react";
import { useI18n, type MessageKey } from "../../../i18n";
import { promptIntelligenceEn } from "../../../i18n/locales/promptIntelligence.en";

/**
 * Translator scoped to the `promptIntelligence.*` catalogue. A test scans the
 * sources and asserts every literal key exists in EN and NL.
 */
export function useT() {
  const { t, language } = useI18n();
  const tt = useCallback(
    (key: string, params?: Record<string, string | number>) => t(`promptIntelligence.${key}` as MessageKey, params),
    [t],
  );
  /** Label for a backend enum value; an unknown (newer) value is shown as plain text. */
  const label = useCallback(
    (group: string, value: string) => {
      const entries = (promptIntelligenceEn as Record<string, unknown>)[group] as Record<string, string> | undefined;
      return entries && Object.prototype.hasOwnProperty.call(entries, value) ? tt(`${group}.${value}`) : value;
    },
    [tt],
  );
  const formatTime = useCallback(
    (iso: string) => {
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(language === "nl" ? "nl-NL" : "en-GB");
    },
    [language],
  );
  return { tt, t, label, formatTime, language };
}

export type TT = ReturnType<typeof useT>["tt"];
