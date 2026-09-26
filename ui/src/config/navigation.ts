import type { MessageKey } from "../i18n";

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
  | "infrastructure"
  | "software-factory"
  | "settings"
  | "spatial-graph";

export type NavigationBadge = number | string;

/** Labels are message keys, resolved in the active language at render time. */
export interface NavigationItem {
  labelKey: MessageKey;
  route: string;
  icon: NavigationIconId;
  badge?: NavigationBadge;
  section: NavigationSectionId;
}

export const navigationSections: Array<{ id: NavigationSectionId; labelKey: MessageKey }> = [
  { id: "main", labelKey: "nav.sections.main" },
  { id: "workspace", labelKey: "nav.sections.workspace" },
  { id: "intelligence", labelKey: "nav.sections.intelligence" },
  { id: "governance", labelKey: "nav.sections.governance" },
];

// Only real routes — no placeholders for modules that do not exist yet.
export const navigationItems: NavigationItem[] = [
  { labelKey: "nav.overview", route: "/overview", icon: "overview", section: "main" },
  { labelKey: "nav.agents", route: "/agents", icon: "agents", section: "main" },
  { labelKey: "nav.tasks", route: "/tasks", icon: "tasks", section: "main" },
  { labelKey: "nav.workflows", route: "/workflows", icon: "workflows", section: "main" },
  { labelKey: "nav.projects", route: "/projects", icon: "projects", section: "workspace" },
  { labelKey: "nav.approvals", route: "/approvals", icon: "approvals", section: "workspace" },
  { labelKey: "nav.infrastructure", route: "/infrastructure", icon: "infrastructure", section: "workspace" },
  { labelKey: "nav.softwareFactory", route: "/software-factory", icon: "software-factory", section: "workspace" },
  { labelKey: "nav.spatialGraph" , route: "/graph", icon: "spatial-graph", section: "main" },
  { labelKey: "nav.knowledge", route: "/knowledge", icon: "knowledge", section: "intelligence" },
  { labelKey: "nav.auditLog", route: "/audit-log", icon: "audit-log", section: "governance" },
  { labelKey: "nav.settings", route: "/settings", icon: "settings", section: "governance" },
];
