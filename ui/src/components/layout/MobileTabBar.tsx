import { NavLink } from "react-router-dom";
import { ClipboardCheck, Factory, LayoutDashboard, Menu, TerminalSquare } from "lucide-react";
import { useI18n } from "../../i18n";
import type { RefObject } from "react";

const TABS = [
  { to: "/overview", key: "home", icon: LayoutDashboard },
  { to: "/software-factory", key: "missions", icon: Factory },
  { to: "/approvals", key: "approvals", icon: ClipboardCheck },
  { to: "/command", key: "command", icon: TerminalSquare },
] as const;

/**
 * UI Layer 7 — thumb-reach bottom navigation on phones. The full module list
 * stays one tap away in the existing drawer ("More"). Hidden above 768px.
 */
export function MobileTabBar({
  onMore,
  moreOpen,
  moreTriggerRef,
}: {
  onMore: () => void;
  moreOpen: boolean;
  moreTriggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useI18n();
  return (
    <nav className="mobile-tabbar" aria-label={t("mobileCommand.tabs.label")}>
      {TABS.map(({ to, key, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `mobile-tabbar__item${isActive ? " is-active" : ""}`}>
          <Icon size={20} aria-hidden />
          <span>{t(`mobileCommand.tabs.${key}`)}</span>
        </NavLink>
      ))}
      <button
        ref={moreTriggerRef}
        type="button"
        className="mobile-tabbar__item"
        aria-expanded={moreOpen}
        aria-controls="mobile-navigation-drawer"
        onClick={onMore}
      >
        <Menu size={20} aria-hidden />
        <span>{t("mobileCommand.tabs.more")}</span>
      </button>
    </nav>
  );
}
