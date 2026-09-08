import { NavLink } from "react-router-dom";
import { NAV_ROUTES } from "../app/routes";
import { useAuth } from "../auth/useAuth";
import { can } from "../auth/permissions";
import { cn } from "../lib/utils";

/** Compact bottom bar for narrow viewports. Full styling comes in UI-2. */
export function MobileNavigation() {
  const { role } = useAuth();
  const items = NAV_ROUTES.filter((route) => can(role, route.permission)).slice(
    0,
    5,
  );

  return (
    <nav className="mobile-nav" aria-label="Primary (compact)">
      {items.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) =>
            cn("mobile-nav__link", isActive && "mobile-nav__link--active")
          }
        >
          <Icon className="mobile-nav__icon" aria-hidden="true" />
          <span className="mobile-nav__label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
