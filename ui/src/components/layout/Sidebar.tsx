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

  return (
    <nav
      className={`sidebar${isRail ? " sidebar--collapsed" : ""}`}
      aria-label="Primary navigation"
    >
      <div className="sidebar__header">
        {isRail ? (
          // Collapsed: the logo sits on top of the "open" control and gives way to it on hover/focus.
          <button
            type="button"
            className="sidebar__brand-toggle"
            onClick={onToggleCollapsed}
            aria-label="Open sidebar"
            aria-expanded={false}
            title="Open sidebar"
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
            aria-label="AI Workforce Control Center — Overview"
            onClick={() => onNavigate?.()}
          >
            <img src={LOGO_SRC} alt="" className="sidebar__logo" />
            <span className="sidebar__brand-copy">
              <span className="sidebar__brand-name">AI Workforce</span>
              <span className="sidebar__brand-subtitle">Control Center</span>
            </span>
          </NavLink>
        )}

        {onToggleCollapsed && !isRail ? (
          <button
            type="button"
            className="sidebar__collapse"
            onClick={onToggleCollapsed}
            aria-label="Close sidebar"
            aria-expanded={true}
            title="Close sidebar"
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
              aria-label={`${section.label} navigation`}
            >
              <div className="sidebar__section-title">{section.label}</div>
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
                        title={isRail ? item.label : undefined}
                        aria-label={isRail ? item.label : undefined}
                      >
                        <span className="sidebar__icon" aria-hidden="true">
                          <Icon size={16} />
                        </span>
                        <span className="sidebar__label">{item.label}</span>
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

      <div className="sidebar__footer" aria-label="System status">
        <div className="sidebar__footer-status">
          <span className="sidebar__footer-dot" aria-hidden="true" />
          <span className="sidebar__label">System ready</span>
        </div>
      </div>
    </nav>
  );
}
