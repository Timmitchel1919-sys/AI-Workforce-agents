import { useCallback } from "react";
import { useI18n, type MessageKey } from "../../../i18n";
import { platformCentersEn } from "../../../i18n/locales/platformCenters.en";

/** Translator scoped to the `platformCenters.*` catalogue (EN/NL key parity is tested). */
export function useT() {
  const { t, language } = useI18n();
  const tt = useCallback(
    (key: string, params?: Record<string, string | number>) => t(`platformCenters.${key}` as MessageKey, params),
    [t],
  );
  /** Label for a backend enum value (`enums.<group>.<VALUE>`); an unknown (newer) value is shown as plain text. */
  const label = useCallback(
    (group: string, value: string) => {
      const entries = (platformCentersEn.enums as Record<string, Record<string, string>>)[group];
      return entries && Object.prototype.hasOwnProperty.call(entries, value) ? tt(`enums.${group}.${value}`) : value;
    },
    [tt],
  );
  const formatTime = useCallback(
    (iso: string | undefined) => {
      if (!iso) return "";
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(language === "nl" ? "nl-NL" : "en-GB");
    },
    [language],
  );
  return { tt, t, label, formatTime, language };
}

export type TT = ReturnType<typeof useT>["tt"];
