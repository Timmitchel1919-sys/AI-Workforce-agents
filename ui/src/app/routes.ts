/**
 * Central route configuration — the single source of truth for navigation,
 * breadcrumbs, document titles, and permission-aware visibility. Never
 * hard-code a path or label anywhere else.
 */
import {
  Bot,
  CheckSquare,
  FolderGit2,
  LayoutDashboard,
  ListTodo,
  BookOpen,
  ScrollText,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { UiCapability } from "../auth/permissions";

export interface NavRoute {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Capability required to see this in navigation (server still enforces). */
  permission: UiCapability;
  /** Document `<title>` segment. */
  title: string;
}

export interface DetailRoute {
  path: string;
  /** The `NavRoute.path` this detail belongs under (for breadcrumbs). */
  parent: string;
  title: string;
}

export const NAV_ROUTES: readonly NavRoute[] = [
  {
    path: "/overview",
    label: "Overview",
    icon: LayoutDashboard,
    permission: "view",
    title: "Overview",
  },
  {
    path: "/agents",
    label: "Agents",
    icon: Bot,
    permission: "view",
    title: "Agents",
  },
  {
    path: "/tasks",
    label: "Tasks",
    icon: ListTodo,
    permission: "view",
    title: "Tasks",
  },
  {
    path: "/workflows",
    label: "Workflows",
    icon: Workflow,
    permission: "view",
    title: "Workflows",
  },
  {
    path: "/projects",
    label: "Projects",
    icon: FolderGit2,
    permission: "view",
    title: "Projects",
  },
  {
    path: "/approvals",
    label: "Approvals",
    icon: CheckSquare,
    permission: "view",
    title: "Approvals",
  },
  {
    path: "/audit",
    label: "Audit Log",
    icon: ScrollText,
    permission: "view",
    title: "Audit Log",
  },
  {
    path: "/knowledge",
    label: "Knowledge",
    icon: BookOpen,
    permission: "view",
    title: "Knowledge",
  },
  {
    path: "/settings",
    label: "Settings",
    icon: Settings,
    permission: "view",
    title: "Settings",
  },
];

export const DETAIL_ROUTES: readonly DetailRoute[] = [
  { path: "/agents/:agentId", parent: "/agents", title: "Agent detail" },
  { path: "/tasks/:taskId", parent: "/tasks", title: "Task detail" },
  {
    path: "/workflows/:workflowId",
    parent: "/workflows",
    title: "Workflow detail",
  },
  {
    path: "/projects/:projectId",
    parent: "/projects",
    title: "Project detail",
  },
];

export const DEFAULT_ROUTE = "/overview";
export const LOGIN_ROUTE = "/login";
export const APP_TITLE = "AI Workforce Control Center";
