import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Command, Menu, Moon, Search, Sun } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { IconButton } from "../ui";
import { getPageTitleKey } from "../../config/pageTitles";
import { LANGUAGE_NATIVE_NAMES, SUPPORTED_LANGUAGES, useI18n } from "../../i18n";
import { useTheme } from "../../themes/useTheme";
import "./TopBar.css";

interface TopBarProps {
  onMobileNavigationToggle?: () => void;
  mobileNavigationOpen?: boolean;
  mobileNavigationTriggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export default function TopBar({
  onMobileNavigationToggle,
  mobileNavigationOpen = false,
  mobileNavigationTriggerRef,
}: TopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const accountLabel = user?.displayName || user?.email || "Operator";
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const pageTitleKey = useMemo(() => getPageTitleKey(location.pathname), [location.pathname]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingField =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") ||
          target.isContentEditable ||
          target.closest("[contenteditable='true']"));

      if (isTypingField) {
        return;
      }

      const isShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";

      if (!isShortcut) {
        return;
      }

      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <header className="topbar app-shell__topbar" aria-label={t("shell.headerActions")}>
      <div className="topbar__content app-shell__topbar-content">
        <div className="topbar__left app-shell__topbar-branding">
          <button
            ref={mobileNavigationTriggerRef}
            type="button"
            className="topbar__nav-trigger"
            aria-label={mobileNavigationOpen ? t("shell.toggleNavigation") : t("shell.openNavigation")}
            aria-controls="mobile-navigation-drawer"
            aria-expanded={mobileNavigationOpen}
            onClick={onMobileNavigationToggle}
          >
            <Menu size={16} aria-hidden="true" />
          </button>

          <div className="topbar__context" aria-live="polite">
            <span className="topbar__eyebrow">{t("shell.currentView")}</span>
            <span className="topbar__title">{t(pageTitleKey)}</span>
          </div>
        </div>

        <div className="topbar__search" role="search" aria-label={t("shell.commandSearch")}>
          <label htmlFor="global-command" className="sr-only">
            {t("shell.searchCommands")}
          </label>
          <Search size={16} className="topbar__search-icon" aria-hidden="true" />
          <input
            id="global-command"
            ref={searchRef}
            className="topbar__search-field"
            type="search"
            role="searchbox"
            aria-label={t("shell.searchCommands")}
            placeholder={t("shell.searchPlaceholder")}
          />
          <span className="topbar__kbd" aria-hidden="true">
            <Command size={12} />
          </span>
        </div>

        <div className="topbar__right app-shell__topbar-actions" aria-label={t("shell.headerActions")}>
          {/* Quick controls; the persistent preferences live in Settings → Appearance. */}
          <div className="topbar__lang" role="group" aria-label={t("shell.languageQuick")}>
            {SUPPORTED_LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                lang={code}
                className={`topbar__lang-option${language === code ? " is-active" : ""}`}
                aria-pressed={language === code}
                aria-label={LANGUAGE_NATIVE_NAMES[code]}
                onClick={() => setLanguage(code)}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>

          <IconButton
            type="button"
            label={nextTheme === "light" ? t("shell.switchToLight") : t("shell.switchToDark")}
            aria-label={nextTheme === "light" ? t("shell.switchToLight") : t("shell.switchToDark")}
            className="topbar__action-button"
            onClick={() => setTheme(nextTheme)}
          >
            {nextTheme === "light" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </IconButton>

          <IconButton
            type="button"
            label={t("shell.notifications")}
            aria-label={t("shell.notifications")}
            className="topbar__action-button"
          >
            <Bell size={16} aria-hidden="true" />
          </IconButton>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="topbar__account-button"
              aria-label={t("shell.accountMenu")}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="topbar__avatar" aria-hidden="true">
                {accountLabel.charAt(0).toUpperCase()}
              </span>
              <span>{accountLabel}</span>
            </button>

            {menuOpen ? (
              <div className="topbar__menu" role="menu" aria-label={t("shell.accountMenu")}>
                <ul className="topbar__menu-list">
                  <li className="topbar__menu-item">
                    <button type="button" className="topbar__menu-button" role="menuitem">
                      {t("shell.profile")}
                    </button>
                  </li>
                  <li className="topbar__menu-item">
                    <button
                      type="button"
                      className="topbar__menu-button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/settings");
                      }}
                    >
                      {t("shell.preferences")}
                    </button>
                  </li>
                  <li className="topbar__menu-item">
                    <button
                      type="button"
                      className="topbar__menu-button"
                      role="menuitem"
                      onClick={async () => {
                        setMenuOpen(false);
                        await signOut();
                        navigate("/login", { replace: true });
                      }}
                    >
                      {t("shell.signOut")}
                    </button>
                  </li>
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
