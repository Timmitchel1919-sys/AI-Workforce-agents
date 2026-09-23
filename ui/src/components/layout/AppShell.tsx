import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { useI18n } from "../../i18n";
import { InstallAppButton } from "../pwa/InstallAppButton";
import "./AppShell.css";

const SIDEBAR_COLLAPSED_KEY = "aw.sidebarCollapsed";

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export default function AppShell() {
  const { t } = useI18n();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    } catch {
      // Storage unavailable (private mode etc.) — the preference just won't persist.
    }
  }, [sidebarCollapsed]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const shouldRestoreTriggerFocus = useRef(false);

  const closeMobileNavigation = () => {
    shouldRestoreTriggerFocus.current = true;
    setMobileNavigationOpen(false);
  };

  useEffect(() => {
    if (mobileNavigationOpen) {
      const focusTarget =
        drawerRef.current?.querySelector<HTMLButtonElement>(
          "button[data-drawer-close]",
        ) ?? null;

      focusTarget?.focus();

      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          closeMobileNavigation();
        }
      };

      window.addEventListener("keydown", handleKeyDown);

      return () => {
        document.body.style.overflow = previousOverflow;
        window.removeEventListener("keydown", handleKeyDown);
      };
    }

    if (shouldRestoreTriggerFocus.current) {
      triggerRef.current?.focus();
      shouldRestoreTriggerFocus.current = false;
    }

    return undefined;
  }, [mobileNavigationOpen]);

  return (
    <div className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
      <aside
        className="app-shell__sidebar"
        aria-label={t("shell.applicationSidebar")}
        hidden={mobileNavigationOpen}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
        />
      </aside>

      {mobileNavigationOpen ? (
        <>
          <button
            type="button"
            className="app-shell__mobile-backdrop"
            aria-label={t("shell.dismissNavigation")}
            tabIndex={-1}
            onClick={closeMobileNavigation}
          />
          <div
            id="mobile-navigation-drawer"
            ref={drawerRef}
            className="app-shell__mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.navigationDrawer")}
          >
            <div className="app-shell__mobile-drawer-header">
              <div className="app-shell__mobile-drawer-title">{t("shell.navigation")}</div>
              <button
                type="button"
                className="app-shell__mobile-close"
                data-drawer-close
                aria-label={t("shell.closeNavigation")}
                onClick={closeMobileNavigation}
              >
                {t("common.close")}
              </button>
            </div>
            <Sidebar onNavigate={closeMobileNavigation} />
            <div className="app-shell__mobile-install">
              <InstallAppButton fullWidth />
            </div>
          </div>
        </>
      ) : null}

      <div className="app-shell__workspace">
        <TopBar
          onMobileNavigationToggle={() => setMobileNavigationOpen((open) => !open)}
          mobileNavigationOpen={mobileNavigationOpen}
          mobileNavigationTriggerRef={triggerRef}
        />

        <main className="app-shell__main" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
