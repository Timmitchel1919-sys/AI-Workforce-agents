import { useAuth } from "../auth/useAuth";
import { useShell } from "./shellContext";
import { SidebarNavigation } from "./SidebarNavigation";
import { APP_DESCRIPTOR, APP_NAME } from "../app/routes";
import { titleCase } from "../lib/formatters";
import { cn } from "../lib/utils";
import { Bot, PanelLeftClose } from "../components/ui/icons";

function initials(name: string | null, email: string | null): string {
  const source = name ?? email ?? "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export function Sidebar() {
  const { user, role } = useAuth();
  const { sidebarCollapsed, toggleSidebar } = useShell();

  return (
    <nav
      className={cn("sidebar", sidebarCollapsed && "sidebar--collapsed")}
      aria-label="Primary"
      data-collapsed={sidebarCollapsed}
    >
      <div className="sidebar__brand">
        {sidebarCollapsed ? (
          // Collapsed: the logo itself is the expand control — the separate
          // collapse button disappears behind it.
          <button
            type="button"
            className="sidebar__brand-toggle"
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            aria-pressed={sidebarCollapsed}
            title="Expand sidebar"
          >
            <Bot className="sidebar__brand-mark" aria-hidden="true" />
          </button>
        ) : (
          <>
            <span className="sidebar__brand-group">
              <Bot className="sidebar__brand-mark" aria-hidden="true" />
              <span className="sidebar__brand-text">
                <span className="sidebar__brand-name">{APP_NAME}</span>
                <span className="sidebar__brand-descriptor">
                  {APP_DESCRIPTOR}
                </span>
              </span>
            </span>
            <button
              type="button"
              className="sidebar__brand-collapse"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              aria-pressed={sidebarCollapsed}
              title="Collapse sidebar"
            >
              <PanelLeftClose className="sidebar__icon" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className="sidebar__scroll">
        <SidebarNavigation collapsed={sidebarCollapsed} />
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__user">
          <span className="avatar" aria-hidden="true">
            {initials(user?.displayName ?? null, user?.email ?? null)}
          </span>
          <span className="sidebar__user-text">
            <span className="sidebar__user-name">
              {user?.displayName ?? user?.email ?? "Operator"}
            </span>
            <span className="sidebar__user-role">
              {role ? titleCase(role) : "—"}
            </span>
          </span>
        </div>
      </div>
    </nav>
  );
}
