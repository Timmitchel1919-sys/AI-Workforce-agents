export type NavigationSectionId = "main" | "workspace" | "intelligence" | "governance";

export type NavigationIconId =
  | "overview"
  | "agents"
  | "tasks"
  | "workflows"
  | "projects"
  | "approvals"
  | "audit-log"
  | "knowledge"
  | "settings";

export type NavigationBadge = number | string;

export interface NavigationItem {
  label: string;
  route: string;
  icon: NavigationIconId;
  badge?: NavigationBadge;
  section: NavigationSectionId;
}

export const navigationSections: Array<{ id: NavigationSectionId; label: string }> = [
  { id: "main", label: "Main" },
  { id: "workspace", label: "Workspace" },
  { id: "intelligence", label: "Intelligence" },
  { id: "governance", label: "Governance" },
];

export const navigationItems: NavigationItem[] = [
  { label: "Overview", route: "/", icon: "overview", section: "main" },
  { label: "Agents", route: "/agents", icon: "agents", section: "main" },
  { label: "Tasks", route: "/tasks", icon: "tasks", section: "main" },
  { label: "Workflows", route: "/workflows", icon: "workflows", section: "main" },
  { label: "Projects", route: "/projects", icon: "projects", section: "workspace" },
  { label: "Approvals", route: "/approvals", icon: "approvals", section: "workspace" },
  { label: "Knowledge", route: "/knowledge", icon: "knowledge", section: "intelligence" },
  { label: "Audit Log", route: "/audit-log", icon: "audit-log", section: "governance" },
  { label: "Settings", route: "/settings", icon: "settings", section: "governance" },
];
