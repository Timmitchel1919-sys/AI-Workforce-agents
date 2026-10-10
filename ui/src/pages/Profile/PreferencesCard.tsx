import { useId } from "react";
import { Moon, Sun, type LucideIcon } from "lucide-react";
import { LANGUAGE_NATIVE_NAMES, SUPPORTED_LANGUAGES, isLanguage, useI18n, type MessageKey } from "../../i18n";
import type { ResolvedTheme } from "../../themes/theme.types";
import { useTheme } from "../../themes/useTheme";
import "../Settings/SettingsPage.css";

const THEME_OPTIONS: Array<{ mode: ResolvedTheme; icon: LucideIcon; label: MessageKey; description: MessageKey }> = [
  { mode: "light", icon: Sun, label: "settings.light", description: "settings.lightDescription" },
  { mode: "dark", icon: Moon, label: "settings.dark", description: "settings.darkDescription" },
];

/**
 * Profile → Preferences: two separate cards, Theme and Language. Both apply
 * immediately, are independent, and persist locally (allowlisted values
 * only). The selected theme shown is the one in effect.
 */
export default function PreferencesCard() {
  const { t, language, setLanguage } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const themeTitleId = useId();
  const languageId = useId();
  const languageHintId = useId();

  return (
    <>
      <section id="preferences" className="settings-section preference-card" aria-labelledby={themeTitleId}>
        <header className="preference-card__header">
          <h2 id={themeTitleId} className="preference-card__title">
            {t("settings.theme")}
          </h2>
          <p className="settings-field__hint">{t("settings.themeDescription")}</p>
        </header>
        <div className="settings-theme-grid" role="radiogroup" aria-labelledby={themeTitleId}>
          {THEME_OPTIONS.map(({ mode, icon: Icon, label, description }) => (
            <label key={mode} className={`settings-theme${resolvedTheme === mode ? " is-selected" : ""}`}>
              <input
                type="radio"
                name="theme"
                value={mode}
                checked={resolvedTheme === mode}
                onChange={() => setTheme(mode)}
                className="settings-theme__input"
              />
              <span className={`settings-theme__preview settings-theme__preview--${mode}`} aria-hidden="true">
                <span className="settings-theme__preview-bar" />
                <span className="settings-theme__preview-card" />
                <span className="settings-theme__preview-card settings-theme__preview-card--short" />
              </span>
              <span className="settings-theme__text">
                <span className="settings-theme__name">
                  <Icon size={16} aria-hidden="true" />
                  {t(label)}
                </span>
                <span className="settings-theme__description">{t(description)}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section preference-card" aria-labelledby={`${languageId}-title`}>
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
