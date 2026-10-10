import { useCallback } from "react";
import { useI18n, type MessageKey } from "../../../i18n";
import { executionCenterEn } from "../../../i18n/locales/executionCenter.en";

/** Translator scoped to the `executionCenter.*` catalogue (EN/NL parity is tested). */
export function useT() {
  const { t, language } = useI18n();
  const tt = useCallback(
    (key: string, params?: Record<string, string | number>) => t(`executionCenter.${key}` as MessageKey, params),
    [t],
  );
  /** Label for a backend enum value; an unknown (newer) value is shown as plain text. */
  const label = useCallback(
    (group: string, value: string) => {
      const entries = (executionCenterEn as Record<string, unknown>)[group] as Record<string, string> | undefined;
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
