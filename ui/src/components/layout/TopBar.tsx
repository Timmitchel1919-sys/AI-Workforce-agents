import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Command, Menu, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { IconButton } from "../ui";
import { getPageTitle } from "../../config/pageTitles";
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
  const accountLabel = user?.displayName || user?.email || "Operator";
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const pageTitle = useMemo(() => getPageTitle(location.pathname), [location.pathname]);

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
    <header className="topbar app-shell__topbar" aria-label="Application header">
      <div className="topbar__content app-shell__topbar-content">
        <div className="topbar__left app-shell__topbar-branding">
          <button
            ref={mobileNavigationTriggerRef}
            type="button"
            className="topbar__nav-trigger"
            aria-label={mobileNavigationOpen ? "Toggle navigation" : "Open navigation"}
            aria-controls="mobile-navigation-drawer"
            aria-expanded={mobileNavigationOpen}
            onClick={onMobileNavigationToggle}
          >
            <Menu size={16} aria-hidden="true" />
          </button>

          <div className="topbar__context" aria-live="polite">
            <span className="topbar__eyebrow">Current view</span>
            <span className="topbar__title">{pageTitle}</span>
          </div>
        </div>

        <div className="topbar__search" role="search" aria-label="Command search">
          <label htmlFor="global-command" className="sr-only">
            Search commands
          </label>
          <Search size={16} className="topbar__search-icon" aria-hidden="true" />
          <input
            id="global-command"
            ref={searchRef}
            className="topbar__search-field"
            type="search"
            role="searchbox"
            aria-label="Search commands"
            placeholder="Search commands or pages"
          />
          <span className="topbar__kbd" aria-hidden="true">
            <Command size={12} />
          </span>
        </div>

        <div className="topbar__right app-shell__topbar-actions" aria-label="Header actions">
          <div
            className="topbar__status"
            role="status"
            aria-label="Control Plane status"
            aria-live="polite"
          >
            <span className="topbar__status-indicator" aria-hidden="true" />
            <span className="topbar__status-label">Control Plane</span>
            <span className="topbar__status-text">Operational</span>
          </div>

          <IconButton
            type="button"
            label="Notifications"
            aria-label="Notifications"
            className="topbar__action-button"
          >
            <Bell size={16} aria-hidden="true" />
          </IconButton>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="topbar__account-button"
              aria-label="Operator menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="topbar__avatar" aria-hidden="true">
                {accountLabel.charAt(0).toUpperCase()}
              </span>
              <span>{accountLabel}</span>
            </button>

            {menuOpen ? (
              <div className="topbar__menu" role="menu" aria-label="Operator menu">
                <ul className="topbar__menu-list">
                  <li className="topbar__menu-item">
                    <button type="button" className="topbar__menu-button" role="menuitem">
                      Profile
                    </button>
                  </li>
                  <li className="topbar__menu-item">
                    <button type="button" className="topbar__menu-button" role="menuitem">
                      Preferences
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
                      Sign out
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
