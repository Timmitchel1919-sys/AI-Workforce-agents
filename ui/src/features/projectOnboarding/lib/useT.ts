import { useCallback } from "react";
import { useI18n, type MessageKey } from "../../../i18n";

/**
 * Translator scoped to the `onboarding.*` catalogue. Keys are checked by a
 * test that scans the sources and asserts every literal exists in EN and NL.
 */
export function useT() {
  const { t, language } = useI18n();
  const tt = useCallback(
    (key: string, params?: Record<string, string | number>) => t(`onboarding.${key}` as MessageKey, params),
    [t],
  );
  return { tt, t, language };
}

export type TT = ReturnType<typeof useT>["tt"];
