import {
  BookOpen,
  Bot,
  ClipboardCheck,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useI18n } from "../../i18n";
import {
  navigationItems,
  navigationSections,
  type NavigationIconId,
} from "../../config/navigation";
import "./Sidebar.css";

const iconMap: Record<NavigationIconId, LucideIcon> = {
  overview: LayoutDashboard,
  agents: Bot,
  tasks: ListTodo,
  workflows: GitBranch,
  projects: FolderKanban,
  approvals: ClipboardCheck,
  "audit-log": ScrollText,
  knowledge: BookOpen,
  settings: Settings,
};

const LOGO_SRC = "/brand/logo-mark.png";

interface SidebarProps {
  onNavigate?: () => void;
  /** Rail mode: icons only. Only meaningful when `onToggleCollapsed` is given. */
  collapsed?: boolean;
  /** Omit to render without a collapse control (e.g. inside the mobile drawer). */
  onToggleCollapsed?: () => void;
}

export default function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const isRail = collapsed && Boolean(onToggleCollapsed);
  const { t } = useI18n();

  return (
    <nav
      className={`sidebar${isRail ? " sidebar--collapsed" : ""}`}
      aria-label={t("shell.primaryNavigation")}
    >
      <div className="sidebar__header">
        {isRail ? (
          // Collapsed: the logo sits on top of the "open" control and gives way to it on hover/focus.
          <button
            type="button"
            className="sidebar__brand-toggle"
            onClick={onToggleCollapsed}
            aria-label={t("shell.openSidebar")}
            aria-expanded={false}
            title={t("shell.openSidebar")}
          >
            <img
              src={LOGO_SRC}
              alt=""
              className="sidebar__logo sidebar__brand-toggle-logo"
            />
            <span className="sidebar__brand-toggle-icon" aria-hidden="true">
              <PanelLeftOpen size={18} />
            </span>
          </button>
        ) : (
          <NavLink
            to="/overview"
            className="sidebar__brand"
            aria-label={t("shell.homeLink")}
            onClick={() => onNavigate?.()}
          >
            <img src={LOGO_SRC} alt="" className="sidebar__logo" />
            <span className="sidebar__brand-copy">
              <span className="sidebar__brand-name">AI Workforce</span>
              <span className="sidebar__brand-subtitle">{t("common.tagline")}</span>
            </span>
          </NavLink>
        )}

        {onToggleCollapsed && !isRail ? (
          <button
            type="button"
            className="sidebar__collapse"
            onClick={onToggleCollapsed}
            aria-label={t("shell.closeSidebar")}
            aria-expanded={true}
            title={t("shell.closeSidebar")}
          >
            <PanelLeftClose size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="sidebar__scroll scroll-panel">
        {navigationSections.map((section) => {
          const sectionItems = navigationItems.filter(
            (item) => item.section === section.id,
          );

          return (
            <div
              key={section.id}
              className="sidebar__section"
              aria-label={t("nav.sectionNavigation", { section: t(section.labelKey) })}
            >
              <div className="sidebar__section-title">{t(section.labelKey)}</div>
              <ul className="sidebar__list">
                {sectionItems.map((item) => {
                  const Icon = iconMap[item.icon];

                  return (
                    <li key={item.route} className="sidebar__item">
                      <NavLink
                        to={item.route}
                        end={item.route === "/overview"}
                        className={({ isActive }) =>
                          `sidebar__link${isActive ? " is-active" : ""}`
                        }
                        onClick={() => onNavigate?.()}
                        title={isRail ? t(item.labelKey) : undefined}
                        aria-label={isRail ? t(item.labelKey) : undefined}
                      >
                        <span className="sidebar__icon" aria-hidden="true">
                          <Icon size={16} />
                        </span>
                        <span className="sidebar__label">{t(item.labelKey)}</span>
                        {item.badge !== undefined ? (
                          <span
                            className="sidebar__badge"
                            aria-label={`${item.badge} notifications`}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="sidebar__footer">
        <p className="sidebar__footer-brand">
          <span className="sidebar__footer-mark" aria-hidden="true" />
          <span className="sidebar__label">{t("shell.brandFooter")}</span>
        </p>
      </div>
    </nav>
  );
}
