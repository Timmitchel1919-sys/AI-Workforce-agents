import type { MessageKey } from "../i18n";

export type NavigationSectionId = "main" | "workspace" | "intelligence" | "integrations" | "governance";

export type NavigationIconId =
  | "overview"
  | "agents"
  | "tasks"
  | "workflows"
  | "workflow-studio"
  | "command"
  | "operations"
  | "security-center"
  | "analytics"
  | "creative"
  | "optimization"
  | "agent-teams"
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
  | "extensions"
  | "organization"
  | "billing"
  | "sso"
  | "admin"
  | "commercial-admin"
  | "customer-ops"
  | "incidents"
  | "privacy"
  | "developer"
  | "secops"
  | "marketing";

export type NavigationBadge = number | string;

/** Labels are message keys, resolved in the active language at render time. */
export interface NavigationItem {
  labelKey: MessageKey;
  route: string;
  icon: NavigationIconId;
  badge?: NavigationBadge;
  section: NavigationSectionId;
  minimumRole?: "admin";
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
  { labelKey: "nav.commandCenter", route: "/command", icon: "command", section: "main" },
  { labelKey: "nav.agents", route: "/agents", icon: "agents", section: "main" },
  { labelKey: "nav.tasks", route: "/tasks", icon: "tasks", section: "main" },
  { labelKey: "nav.workflows", route: "/workflows", icon: "workflows", section: "main" },
  { labelKey: "nav.workflowStudio", route: "/workflow-studio", icon: "workflow-studio", section: "workspace" },
  { labelKey: "nav.opsCenter", route: "/operations", icon: "operations", section: "workspace" },
  { labelKey: "nav.agentTeams", route: "/agent-teams", icon: "agent-teams", section: "workspace" },
  { labelKey: "nav.creativeStudio", route: "/creative", icon: "creative", section: "workspace" },
  { labelKey: "nav.analyticsStudio", route: "/analytics", icon: "analytics", section: "intelligence" },
  { labelKey: "nav.optimization", route: "/optimization", icon: "optimization", section: "intelligence" },
  { labelKey: "nav.securityCenter", route: "/security-center", icon: "security-center", section: "governance" },
  { labelKey: "nav.projects", route: "/projects", icon: "projects", section: "workspace" },
  { labelKey: "nav.approvals", route: "/approvals", icon: "approvals", section: "workspace" },
  { labelKey: "nav.infrastructure", route: "/infrastructure", icon: "infrastructure", section: "workspace" },
  { labelKey: "nav.softwareFactory", route: "/software-factory", icon: "software-factory", section: "workspace" },
  { labelKey: "nav.spatialGraph" , route: "/graph", icon: "spatial-graph", section: "main" },
  { labelKey: "nav.intelligence", route: "/intelligence", icon: "intelligence", section: "intelligence" },
  { labelKey: "nav.governanceControls", route: "/governance", icon: "governance", section: "governance" },
  { labelKey: "nav.continuity", route: "/continuity", icon: "governance", section: "governance" },
  { labelKey: "nav.costCenter", route: "/cost", icon: "cost-center", section: "governance" },
  { labelKey: "nav.auditLog", route: "/audit-log", icon: "audit-log", section: "governance" },
  { labelKey: "nav.settings", route: "/settings", icon: "settings", section: "governance" },
  { labelKey: "nav.integrations", route: "/integrations", icon: "integrations", section: "integrations" },
  { labelKey: "nav.extensions", route: "/extensions", icon: "extensions", section: "integrations" },
  // Private-mode: enterprise/SaaS navigation entries are intentionally not
  // exposed in the sidebar. Routes remain registered for direct-URL access
  // during the deprecation window but are no longer part of the user-facing
  // navigation surface. Items removed: organization, billing, sso,
  // commercial-admin, customer-ops, marketing. See PHASE 17 cleanup report.
  { labelKey: "nav.platformAdmin", route: "/admin", icon: "admin", section: "governance", minimumRole: "admin" },
  { labelKey: "nav.incidents", route: "/incidents", icon: "incidents", section: "governance" },
  { labelKey: "nav.privacy", route: "/privacy", icon: "privacy", section: "governance", minimumRole: "admin" },
  { labelKey: "nav.developer", route: "/developer-platform", icon: "developer", section: "main", minimumRole: "admin" },
  { labelKey: "nav.secops", route: "/secops", icon: "secops", section: "governance", minimumRole: "admin" },
  { labelKey: "nav.trustCenter", route: "/trust", icon: "governance", section: "governance" },
  { labelKey: "nav.itsm", route: "/itsm", icon: "infrastructure", section: "governance" },
];

export function visibleNavigationItems(role: "viewer" | "operator" | "admin" | undefined) {
  return navigationItems.filter((item) => !item.minimumRole || role === item.minimumRole);
}
