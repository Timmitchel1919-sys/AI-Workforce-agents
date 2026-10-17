import type { ApprovalItem, AuditItem, RiskLevel } from "../governance";

export const NOTIFICATION_CATEGORIES = ["project", "execution", "approval", "security", "deployment", "system"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationPriority = "critical" | "high" | "normal";

export interface WorkforceNotification {
  id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  detail: string;
  occurredAt: string;
  route: string;
  source: "approval" | "audit";
}

const categoryMatchers: ReadonlyArray<readonly [NotificationCategory, RegExp]> = [
  ["security", /security|permission|policy|auth|denied|forbidden|risk|secret/i],
  ["deployment", /deploy|release|rollback|artifact|hosting/i],
  ["approval", /approv|review|reject/i],
  ["execution", /execut|runner|workflow|task|command|job/i],
  ["project", /project|program|workspace/i],
];

function categoryFor(type: string): NotificationCategory {
  return categoryMatchers.find(([, pattern]) => pattern.test(type))?.[0] ?? "system";
}

function priorityForAudit(item: AuditItem): NotificationPriority {
  const signal = `${item.type} ${item.outcome ?? ""}`;
  if (/critical|breach|compromis|failed|denied|rollback/i.test(signal)) return "critical";
  if (/warning|degraded|blocked|reject|expired/i.test(signal)) return "high";
  return "normal";
}

function priorityForRisk(risk: RiskLevel): NotificationPriority {
  return risk === "high" ? "critical" : risk === "medium" ? "high" : "normal";
}

function routeFor(category: NotificationCategory, projectId?: string): string {
  if (category === "approval") return "/approvals";
  if (category === "security") return "/security";
  if (category === "deployment" || category === "execution") return projectId ? `/projects/${encodeURIComponent(projectId)}/operations` : "/operations";
  if (category === "project") return projectId ? `/projects/${encodeURIComponent(projectId)}` : "/projects";
  return "/audit-log";
}

export function buildNotifications(
  approvals: readonly ApprovalItem[],
  audit: readonly AuditItem[],
): WorkforceNotification[] {
  const approvalItems = approvals.map<WorkforceNotification>((item) => ({
    id: `approval:${item.approvalId}`,
    category: "approval",
    priority: priorityForRisk(item.risk),
    title: item.action,
    detail: item.reason,
    occurredAt: item.requestedAt,
    route: routeFor("approval", item.projectId),
    source: "approval",
  }));
  const auditItems = audit.map<WorkforceNotification>((item) => {
    const category = categoryFor(item.type);
    return {
      id: `audit:${item.id}`,
      category,
      priority: priorityForAudit(item),
      title: item.type,
      detail: item.outcome ?? item.actor ?? "Recorded by the Control Plane",
      occurredAt: item.timestamp,
      route: routeFor(category, item.projectId),
      source: "audit",
    };
  });
  return [...approvalItems, ...auditItems].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

