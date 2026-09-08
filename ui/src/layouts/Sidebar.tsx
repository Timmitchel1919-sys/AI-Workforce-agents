import { NavLink } from "react-router-dom";
import { NAV_ROUTES } from "../app/routes";
import { useAuth } from "../auth/useAuth";
import { can } from "../auth/permissions";
import { cn } from "../lib/utils";

export function Sidebar() {
  const { role } = useAuth();
  const items = NAV_ROUTES.filter((route) => can(role, route.permission));

  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="sidebar__brand">AI Workforce</div>
      <ul className="sidebar__list">
        {items.map(({ path, label, icon: Icon }) => (
          <li key={path}>
            <NavLink
              to={path}
              className={({ isActive }) =>
                cn("sidebar__link", isActive && "sidebar__link--active")
              }
            >
              <Icon className="sidebar__icon" aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
