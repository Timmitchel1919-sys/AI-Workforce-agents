import { useId } from "react";
import { LANGUAGE_NATIVE_NAMES, SUPPORTED_LANGUAGES, isLanguage, useI18n } from "../../i18n";
import "../Settings/SettingsPage.css";

/**
 * Settings → Preferences: language applies immediately and persists locally.
 */
export default function PreferencesCard() {
  const { t, language, setLanguage } = useI18n();
  const languageId = useId();
  const languageHintId = useId();

  return (
    <>
      <section id="preferences" className="settings-section preference-card" aria-labelledby={`${languageId}-title`}>
        <header className="preference-card__header">
          <h2 id={`${languageId}-title`} className="preference-card__title">
            {t("settings.language")}
          </h2>
          <p id={languageHintId} className="settings-field__hint">
            {t("settings.languageDescription")}
          </p>
        </header>
        <select
          id={languageId}
          className="ui-select settings-language"
          value={language}
          aria-labelledby={`${languageId}-title`}
          aria-describedby={languageHintId}
          onChange={(event) => {
            if (isLanguage(event.target.value)) setLanguage(event.target.value);
          }}
        >
          {SUPPORTED_LANGUAGES.map((code) => (
            <option key={code} value={code} lang={code}>
              {LANGUAGE_NATIVE_NAMES[code]}
            </option>
          ))}
        </select>
        <p className="settings-note">{t("settings.storageNote")}</p>
      </section>
    </>
  );
}
