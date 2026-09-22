import {
  BookOpen,
  Bot,
  ClipboardCheck,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  ListTodo,
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

interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Primary navigation">
      <div className="sidebar__brand" aria-label="AI Workforce Control Center">
        <div className="sidebar__brand-mark" aria-hidden="true">
          AW
        </div>
        <div className="sidebar__brand-copy">
          <span className="sidebar__brand-name">AI Workforce</span>
          <span className="sidebar__brand-subtitle">Control Center</span>
        </div>
      </div>

      {navigationSections.map((section) => {
        const sectionItems = navigationItems.filter((item) => item.section === section.id);

        return (
          <div key={section.id} className="sidebar__section" aria-label={`${section.label} navigation`}>
            <div className="sidebar__section-title">{section.label}</div>
            <ul className="sidebar__list">
              {sectionItems.map((item) => {
                const Icon = iconMap[item.icon];

                return (
                  <li key={item.route} className="sidebar__item">
                    <NavLink
                      to={item.route}
                      end={item.route === "/"}
                      className={({ isActive }) =>
                        `sidebar__link${isActive ? " is-active" : ""}`
                      }
                      onClick={() => onNavigate?.()}
                    >
                      <span className="sidebar__icon" aria-hidden="true">
                        <Icon size={16} />
                      </span>
                      <span className="sidebar__label">{item.label}</span>
                      {item.badge !== undefined ? (
                        <span className="sidebar__badge" aria-label={`${item.badge} notifications`}>
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

      <div className="sidebar__footer" aria-label="System status">
        <div className="sidebar__footer-status">
          <span className="sidebar__footer-dot" aria-hidden="true" />
          <span>System ready</span>
        </div>
      </div>
    </nav>
  );
}
