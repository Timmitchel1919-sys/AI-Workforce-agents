import { useShell } from "./shellContext";
import { SidebarNavigation } from "./SidebarNavigation";
import { APP_DESCRIPTOR, APP_NAME } from "../app/routes";
import { Drawer } from "../components/ui";

/**
 * Mobile navigation — a focus-trapping drawer (UI-2 `Drawer`, native
 * `<dialog>`). Same route config as the desktop sidebar. Closes on Escape, on
 * backdrop click, and after a navigation; focus returns to the trigger.
 */
export function MobileNavigation() {
  const { mobileNavOpen, closeMobileNav } = useShell();

  return (
    <div className="mobile-nav-drawer">
      <Drawer
        open={mobileNavOpen}
        onClose={closeMobileNav}
        title={`${APP_NAME} · ${APP_DESCRIPTOR}`}
      >
        <nav aria-label="Primary (mobile)" className="mobile-nav__body">
          <SidebarNavigation onNavigate={closeMobileNav} />
        </nav>
      </Drawer>
    </div>
  );
}
