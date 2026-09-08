import { Outlet } from "react-router-dom";
import { RequireAuth } from "../auth/RequireAuth";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNavigation } from "./MobileNavigation";

/**
 * The authenticated shell: left navigation, top status bar, scrollable main
 * content. Wrapped in `RequireAuth` so nothing here renders until the auth
 * state resolves.
 */
export function ControlCenterLayout() {
  return (
    <RequireAuth>
      <div className="app-shell">
        <Sidebar />
        <div className="app-shell__main">
          <Topbar />
          <main className="app-shell__content">
            <Outlet />
          </main>
          <MobileNavigation />
        </div>
      </div>
    </RequireAuth>
  );
}
