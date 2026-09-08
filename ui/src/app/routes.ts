/**
 * Central route configuration — the single source of truth for navigation,
 * breadcrumbs, document titles, and permission-aware visibility. Never
 * hard-code a path or label anywhere else.
 */
import {
  Bot,
  ShieldCheck,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  BookOpen,
  ScrollText,
  Settings,
  Workflow,
  type LucideIcon,
} from "../components/ui/icons";
import type { UiCapability } from "../auth/permissions";

export type NavSection = "workspace" | "system";

export interface NavRoute {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Capability required to see this in navigation (server still enforces). */
  permission: UiCapability;
  /** Document `<title>` segment. */
  title: string;
  /** Sidebar grouping. */
  section: NavSection;
}

export interface DetailRoute {
  path: string;
  /** The `NavRoute.path` this detail belongs under (for breadcrumbs). */
  parent: string;
  /** URL param that carries the resource id (for the breadcrumb leaf + title). */
  param: string;
  /** Singular noun for the breadcrumb/title, e.g. "Agent". */
  noun: string;
}

export const NAV_ROUTES: readonly NavRoute[] = [
  {
    path: "/overview",
    label: "Overview",
    icon: LayoutDashboard,
    permission: "view",
    title: "Overview",
    section: "workspace",
  },
  {
    path: "/agents",
    label: "Agents",
    icon: Bot,
    permission: "view",
    title: "Agents",
    section: "workspace",
  },
  {
    path: "/tasks",
    label: "Tasks",
    icon: ListChecks,
    permission: "view",
    title: "Tasks",
    section: "workspace",
  },
  {
    path: "/workflows",
    label: "Workflows",
    icon: Workflow,
    permission: "view",
    title: "Workflows",
    section: "workspace",
  },
  {
    path: "/projects",
    label: "Projects",
    icon: FolderKanban,
    permission: "view",
    title: "Projects",
    section: "workspace",
  },
  {
    path: "/approvals",
    label: "Approvals",
    icon: ShieldCheck,
    permission: "view",
    title: "Approvals",
    section: "workspace",
  },
  {
    path: "/audit",
    label: "Audit Log",
    icon: ScrollText,
    permission: "view",
    title: "Audit Log",
    section: "workspace",
  },
  {
    path: "/knowledge",
    label: "Knowledge",
    icon: BookOpen,
    permission: "view",
    title: "Knowledge",
    section: "workspace",
  },
  {
    path: "/settings",
    label: "Settings",
    icon: Settings,
    permission: "view",
    title: "Settings",
    section: "system",
  },
];

export const DETAIL_ROUTES: readonly DetailRoute[] = [
  {
    path: "/agents/:agentId",
    parent: "/agents",
    param: "agentId",
    noun: "Agent",
  },
  { path: "/tasks/:taskId", parent: "/tasks", param: "taskId", noun: "Task" },
  {
    path: "/workflows/:workflowId",
    parent: "/workflows",
    param: "workflowId",
    noun: "Workflow",
  },
  {
    path: "/projects/:projectId",
    parent: "/projects",
    param: "projectId",
    noun: "Project",
  },
];

export const DEFAULT_ROUTE = "/overview";
export const LOGIN_ROUTE = "/login";
export const APP_TITLE = "AI Workforce Control Center";
export const APP_NAME = "AI Workforce";
export const APP_DESCRIPTOR = "Control Center";

export function navRoutesBySection(section: NavSection): readonly NavRoute[] {
  return NAV_ROUTES.filter((route) => route.section === section);
}

/** The `NavRoute` whose nav item should be highlighted for a pathname. */
export function resolveActiveNav(pathname: string): NavRoute | undefined {
  const exact = NAV_ROUTES.find((route) => route.path === pathname);
  if (exact) return exact;
  const detail = DETAIL_ROUTES.find((route) =>
    pathname.startsWith(`${route.parent}/`),
  );
  if (detail) return NAV_ROUTES.find((route) => route.path === detail.parent);
  const prefixed = NAV_ROUTES.find(
    (route) => route.path !== "/" && pathname.startsWith(`${route.path}/`),
  );
  return prefixed;
}

export interface Breadcrumb {
  label: string;
  to?: string;
}

/** Route-derived breadcrumb trail. */
export function resolveBreadcrumbs(
  pathname: string,
  params: Readonly<Record<string, string | undefined>> = {},
): Breadcrumb[] {
  const nav = NAV_ROUTES.find((route) => route.path === pathname);
  if (nav) return [{ label: nav.label }];

  const detail = DETAIL_ROUTES.find((route) =>
    pathname.startsWith(`${route.parent}/`),
  );
  if (detail) {
    const parent = NAV_ROUTES.find((route) => route.path === detail.parent);
    const id = params[detail.param];
    return [
      { label: parent?.label ?? detail.noun, to: detail.parent },
      { label: id ? `${detail.noun} ${id}` : `${detail.noun} detail` },
    ];
  }
  return [];
}

/** Document `<title>` segment for a pathname. */
export function resolvePageTitle(
  pathname: string,
  params: Readonly<Record<string, string | undefined>> = {},
): string | undefined {
  const nav = NAV_ROUTES.find((route) => route.path === pathname);
  if (nav) return nav.title;
  const detail = DETAIL_ROUTES.find((route) =>
    pathname.startsWith(`${route.parent}/`),
  );
  if (detail) {
    const id = params[detail.param];
    return id ? `${detail.noun} ${id}` : `${detail.noun}`;
  }
  return undefined;
}
