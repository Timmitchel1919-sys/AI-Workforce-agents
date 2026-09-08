import type { ReactNode } from "react";
import { PageContainer, PageHeader } from "./Layout";

/**
 * The reusable page frame every Control Center page composes from:
 *
 *   PageFrame
 *   ├── PageHeader (title · description · actions)
 *   └── children (the page content)
 *
 * Breadcrumbs live in the topbar (route context), so they are not repeated
 * here. Feature content — tables, cards, forms — is the caller's concern.
 */
export function PageFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <PageContainer>
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </PageContainer>
  );
}
