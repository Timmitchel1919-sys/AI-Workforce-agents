import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import "./AppShell.css";

export default function AppShell() {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
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
          'button[aria-label="Close navigation"]',
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
    <div className="app-shell">
      <aside
        className="app-shell__sidebar"
        aria-label="Application sidebar"
        hidden={mobileNavigationOpen}
      >
        <Sidebar />
      </aside>

      {mobileNavigationOpen ? (
        <>
          <button
            type="button"
            className="app-shell__mobile-backdrop"
            aria-label="Dismiss navigation drawer"
            tabIndex={-1}
            onClick={closeMobileNavigation}
          />
          <div
            id="mobile-navigation-drawer"
            ref={drawerRef}
            className="app-shell__mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation drawer"
          >
            <div className="app-shell__mobile-drawer-header">
              <div className="app-shell__mobile-drawer-title">Navigation</div>
              <button
                type="button"
                className="app-shell__mobile-close"
                aria-label="Close navigation"
                onClick={closeMobileNavigation}
              >
                Close
              </button>
            </div>
            <Sidebar onNavigate={closeMobileNavigation} />
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
