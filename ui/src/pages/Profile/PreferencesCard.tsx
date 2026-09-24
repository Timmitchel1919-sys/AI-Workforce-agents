import { useId } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { LANGUAGE_NATIVE_NAMES, SUPPORTED_LANGUAGES, isLanguage, useI18n, type MessageKey } from "../../i18n";
import type { ThemeMode } from "../../themes/theme.types";
import { useTheme } from "../../themes/useTheme";
import "../Settings/SettingsPage.css";

const THEME_OPTIONS: Array<{ mode: ThemeMode; icon: LucideIcon; label: MessageKey; description: MessageKey }> = [
  { mode: "light", icon: Sun, label: "settings.light", description: "settings.lightDescription" },
  { mode: "dark", icon: Moon, label: "settings.dark", description: "settings.darkDescription" },
  { mode: "system", icon: Monitor, label: "settings.system", description: "settings.systemDescription" },
];

/**
 * Profile → Preferences: the only place for theme and language. Both apply
 * immediately, are independent, and persist locally (allowlisted values only).
 */
export default function PreferencesCard() {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const languageId = useId();
  const languageHintId = useId();

  return (
    <section id="preferences" className="settings-section profile-card" aria-labelledby="profile-preferences">
      <header className="settings-section__header">
        <h2 id="profile-preferences" className="settings-section__title">
          {t("profile.preferencesTitle")}
        </h2>
        <p className="settings-section__description">{t("profile.preferencesDescription")}</p>
      </header>

      <fieldset className="settings-field">
        <legend className="settings-field__label">{t("settings.theme")}</legend>
        <p className="settings-field__hint">{t("settings.themeDescription")}</p>
        <div className="settings-theme-grid">
          {THEME_OPTIONS.map(({ mode, icon: Icon, label, description }) => (
            <label key={mode} className={`settings-theme${theme === mode ? " is-selected" : ""}`}>
              <input
                type="radio"
                name="theme"
                value={mode}
                checked={theme === mode}
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
      </fieldset>

      <div className="settings-field">
        <label htmlFor={languageId} className="settings-field__label">
          {t("settings.language")}
        </label>
        <p id={languageHintId} className="settings-field__hint">
          {t("settings.languageDescription")}
        </p>
        <select
          id={languageId}
          className="ui-select settings-language"
          value={language}
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
      </div>

      <p className="settings-note">{t("settings.storageNote")}</p>
    </section>
  );
}
