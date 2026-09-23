import type { MessageKey } from "../i18n";

export const pageTitleKeys: Record<string, MessageKey> = {
  "/overview": "nav.overview",
  "/agents": "nav.agents",
  "/tasks": "nav.tasks",
  "/workflows": "nav.workflows",
  "/projects": "nav.projects",
  "/approvals": "nav.approvals",
  "/audit-log": "nav.auditLog",
  "/knowledge": "nav.knowledge",
  "/settings": "nav.settings",
  "/design-system": "nav.designSystem",
};

/** Message key for the page title; detail routes use their module's title. */
export function getPageTitleKey(pathname: string): MessageKey {
  const exact = pageTitleKeys[pathname];
  if (exact) return exact;
  const base = `/${pathname.split("/").filter(Boolean)[0] ?? ""}`;
  return pageTitleKeys[base] ?? "nav.overview";
}
