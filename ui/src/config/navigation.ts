import type { MessageKey } from "../i18n";

export type NavigationSectionId = "main" | "workspace" | "intelligence" | "integrations" | "governance";

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
  | "spatial-graph"
  | "governance"
  | "cost-center"
  | "intelligence"
  | "integrations"
  | "organization"
  | "admin";

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
  { id: "integrations", labelKey: "nav.integrations" },
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
  { labelKey: "nav.intelligence", route: "/intelligence", icon: "intelligence", section: "intelligence" },
  { labelKey: "nav.governanceControls", route: "/governance", icon: "governance", section: "governance" },
  { labelKey: "nav.costCenter", route: "/cost", icon: "cost-center", section: "governance" },
  { labelKey: "nav.auditLog", route: "/audit-log", icon: "audit-log", section: "governance" },
  { labelKey: "nav.settings", route: "/settings", icon: "settings", section: "governance" },
  { labelKey: "nav.integrations", route: "/integrations", icon: "integrations", section: "integrations" },
  { labelKey: "nav.organization", route: "/organizations", icon: "organization", section: "main" },
  { labelKey: "nav.platformAdmin", route: "/admin", icon: "admin", section: "governance" },
];
