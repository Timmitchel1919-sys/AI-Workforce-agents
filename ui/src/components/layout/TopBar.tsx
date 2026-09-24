import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Command, LogOut, Menu, Search, SlidersHorizontal, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { IconButton, UserAvatar } from "../ui";
import { getPageTitleKey } from "../../config/pageTitles";
import { useMyProfile } from "../../features/profile";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
  const { data: profile } = useMyProfile();
  const accountLabel = user?.displayName || user?.email || "Operator";
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
          <IconButton
            type="button"
            label={t("shell.notifications")}
            aria-label={t("shell.notifications")}
            className="topbar__action-button"
          >
            <Bell size={16} aria-hidden="true" />
          </IconButton>

          <div className="topbar__account">
            <button
              type="button"
              className="topbar__account-button"
              aria-label={t("shell.accountMenu")}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <UserAvatar name={accountLabel} src={profile?.avatarDataUrl} size={30} className="topbar__avatar" />
              <span className="topbar__account-name">{accountLabel}</span>
            </button>

            {menuOpen ? (
              <div className="topbar__menu" role="menu" aria-label={t("shell.accountMenu")}>
                <ul className="topbar__menu-list">
                  <li className="topbar__menu-item">
                    <button
                      type="button"
                      className="topbar__menu-button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/profile");
                      }}
                    >
                      <UserRound size={15} aria-hidden="true" />
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
                        navigate("/profile#preferences");
                      }}
                    >
                      <SlidersHorizontal size={15} aria-hidden="true" />
                      {t("shell.preferences")}
                    </button>
                  </li>
                  <li className="topbar__menu-item topbar__menu-item--separated">
                    <button
                      type="button"
                      className="topbar__menu-button topbar__menu-button--danger"
                      role="menuitem"
                      onClick={async () => {
                        setMenuOpen(false);
                        await signOut();
                        navigate("/login", { replace: true });
                      }}
                    >
                      <LogOut size={15} aria-hidden="true" />
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
