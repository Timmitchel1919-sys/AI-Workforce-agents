import { NavLink, useLocation } from "react-router-dom";
import {
  navRoutesBySection,
  resolveActiveNav,
  type NavRoute,
  type NavSection,
} from "../app/routes";
import { useAuth } from "../auth/useAuth";
import { can } from "../auth/permissions";
import { cn } from "../lib/utils";
import { Tooltip } from "../components/ui";

const SECTION_LABEL: Record<NavSection, string> = {
  workspace: "Workspace",
  system: "System",
};

function NavItem({
  route,
  collapsed,
  active,
  onNavigate,
}: {
  route: NavRoute;
  collapsed: boolean;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { icon: Icon, path, label } = route;
  const link = (
    <NavLink
      to={path}
      onClick={onNavigate}
      className={cn("sidebar__link", active && "is-active")}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
    >
      <Icon className="sidebar__icon" aria-hidden="true" />
      {collapsed ? null : <span className="sidebar__link-label">{label}</span>}
    </NavLink>
  );
  return (
    <li>{collapsed ? <Tooltip content={label}>{link}</Tooltip> : link}</li>
  );
}

/**
 * The single navigation list, shared by the desktop sidebar and the mobile
 * drawer. Route metadata comes from `app/routes.ts` — never re-declared.
 */
export function SidebarNavigation({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { role } = useAuth();
  const { pathname } = useLocation();
  const activePath = resolveActiveNav(pathname)?.path;

  const sections: NavSection[] = ["workspace", "system"];

  return (
    <>
      {sections.map((section) => {
        const routes = navRoutesBySection(section).filter((route) =>
          can(role, route.permission),
        );
        if (routes.length === 0) return null;
        return (
          <div className="sidebar__section" key={section}>
            <span className="sidebar__section-label">
              {SECTION_LABEL[section]}
            </span>
            <ul className="sidebar__list">
              {routes.map((route) => (
                <NavItem
                  key={route.path}
                  route={route}
                  collapsed={collapsed}
                  active={route.path === activePath}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
