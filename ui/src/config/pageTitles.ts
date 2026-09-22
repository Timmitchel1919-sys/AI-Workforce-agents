export const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/agents": "Agents",
  "/tasks": "Tasks",
  "/workflows": "Workflows",
  "/projects": "Projects",
  "/approvals": "Approvals",
  "/audit-log": "Audit Log",
  "/knowledge": "Knowledge",
  "/settings": "Settings",
  "/design-system": "Design System",
};

export function getPageTitle(pathname: string): string {
  const mappedTitle = pageTitles[pathname];

  if (mappedTitle) {
    return mappedTitle;
  }

  const fallbackTitle = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[-_]/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

  return fallbackTitle || "Overview";
}
