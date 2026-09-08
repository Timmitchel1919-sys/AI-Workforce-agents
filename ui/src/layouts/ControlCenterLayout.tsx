import { useEffect } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { RequireAuth } from "../auth/RequireAuth";
import { ShellProvider } from "./ShellProvider";
import { useShell } from "./shellContext";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNavigation } from "./MobileNavigation";
import { ShellErrorBoundary } from "./ShellErrorBoundary";
import { APP_TITLE, resolvePageTitle } from "../app/routes";

function useShellDocumentTitle() {
  const { pathname } = useLocation();
  const params = useParams();
  useEffect(() => {
    const segment = resolvePageTitle(pathname, params);
    // A known route owns the title here; unknown routes (e.g. 404) set their own.
    if (segment) document.title = `${segment} · ${APP_TITLE}`;
  }, [pathname, params]);
}

function ShellFrame() {
  const { sidebarCollapsed } = useShell();
  useShellDocumentTitle();

  return (
    <div className="app-shell" data-collapsed={sidebarCollapsed}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Sidebar />
      <div className="app-shell__main">
        <Topbar />
        <main id="main-content" className="app-shell__content" tabIndex={-1}>
          <ShellErrorBoundary>
            <Outlet />
          </ShellErrorBoundary>
        </main>
      </div>
      <MobileNavigation />
    </div>
  );
}

/**
 * The persistent authenticated shell. Nested-layout route: mounts under the
 * router, renders `<Outlet />` for the active page. No business logic; no data
 * fetching — pages request their own data.
 */
export function ControlCenterLayout() {
  return (
    <RequireAuth>
      <ShellProvider>
        <ShellFrame />
      </ShellProvider>
    </RequireAuth>
  );
}
