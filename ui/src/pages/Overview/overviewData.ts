// DEVELOPMENT FALLBACK ONLY.
// This file remains as a temporary local fallback for the Overview layer while the
// Control Plane contract is being connected. It is not production data.
export type MetricStatus = "positive" | "neutral" | "warning";
export type TrendDirection = "up" | "down" | "neutral";
export type ActivityType = "agent" | "task" | "workflow" | "approval" | "system";
export type ActivityStatus = "active" | "completed" | "running" | "pending" | "failed" | "paused";

export interface Metric {
  id: string;
  label: string;
  value: number;
  context: string;
  status: MetricStatus;
  trend: number;
  trendDirection: TrendDirection;
  linkTo?: string;
}

export type OverviewMetric = Metric;

export interface OverviewSummaryCard {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: ActivityStatus;
  linkTo?: string;
}

export interface RecentActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: string;
  status: ActivityStatus;
  actor?: string;
  project?: string;
  linkTo?: string;
}

export const overviewMetrics: OverviewMetric[] = [
  {
    id: "active-agents",
    label: "Active Agents",
    value: 12,
    context: "Currently operational",
    status: "positive",
    trend: 2,
    trendDirection: "up",
    linkTo: "/agents",
  },
  {
    id: "running-tasks",
    label: "Running Tasks",
    value: 24,
    context: "Across active projects",
    status: "neutral",
    trend: 6,
    trendDirection: "up",
    linkTo: "/tasks",
  },
  {
    id: "active-workflows",
    label: "Active Workflows",
    value: 8,
    context: "Currently executing",
    status: "positive",
    trend: 1,
    trendDirection: "up",
    linkTo: "/workflows",
  },
  {
    id: "pending-approvals",
    label: "Pending Approvals",
    value: 3,
    context: "Require operator attention",
    status: "warning",
    trend: 1,
    trendDirection: "up",
    linkTo: "/approvals",
  },
];

export const overviewSummaryCards: OverviewSummaryCard[] = [
  {
    id: "agents",
    title: "Agent Activity",
    value: "12 agents active",
    detail: "12 agents currently operational",
    status: "active",
    linkTo: "/agents",
  },
  {
    id: "tasks",
    title: "Task Execution",
    value: "24 tasks running",
    detail: "24 tasks currently executing",
    status: "running",
    linkTo: "/tasks",
  },
  {
    id: "workflows",
    title: "Workflow Engine",
    value: "8 workflows active",
    detail: "8 workflows currently active",
    status: "active",
    linkTo: "/workflows",
  },
  {
    id: "approvals",
    title: "Approvals",
    value: "3 pending",
    detail: "3 approvals require operator attention",
    status: "pending",
    linkTo: "/approvals",
  },
];

export const recentActivity: RecentActivityItem[] = [
  {
    id: "a1",
    type: "agent",
    title: "Agent started",
    description: "Research Agent became operational and resumed monitoring.",
    timestamp: "2 min ago",
    status: "active",
    actor: "Research Agent",
    project: "Market intelligence",
    linkTo: "/agents",
  },
  {
    id: "a2",
    type: "task",
    title: "Task completed",
    description: "Market analysis task completed successfully.",
    timestamp: "8 min ago",
    status: "completed",
    actor: "Research Agent",
    project: "Market Intelligence",
    linkTo: "/tasks",
  },
  {
    id: "a3",
    type: "workflow",
    title: "Workflow executed",
    description: "Daily intelligence workflow completed without intervention.",
    timestamp: "16 min ago",
    status: "completed",
    actor: "Workflow Engine",
    project: "Daily briefing",
    linkTo: "/workflows",
  },
  {
    id: "a4",
    type: "approval",
    title: "Approval requested",
    description: "Campaign approval requires operator review before distribution.",
    timestamp: "24 min ago",
    status: "pending",
    actor: "Operations lead",
    project: "Campaign launch",
    linkTo: "/approvals",
  },
  {
    id: "a5",
    type: "system",
    title: "System stable",
    description: "Control Plane heartbeat remained stable during peak activity.",
    timestamp: "41 min ago",
    status: "active",
    actor: "Control Plane",
    project: "Platform health",
  },
  {
    id: "a6",
    type: "task",
    title: "Task paused",
    description: "Data export was paused for a resource re-route.",
    timestamp: "1 hr ago",
    status: "paused",
    actor: "Data pipeline",
    project: "Warehouse sync",
    linkTo: "/tasks",
  },
];
