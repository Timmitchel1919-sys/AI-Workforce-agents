import type { ReactNode } from "react";
import { PageContainer, PageHeader } from "../components/layout";
import { useDocumentTitle } from "../hooks";

/**
 * Route placeholder — proves route + layout + title wiring. The real page
 * arrives in a later UI phase; UI-2 only established the primitives it uses.
 */
export function PlaceholderPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <PageContainer>
      <PageHeader
        title={title}
        description={description ?? "This view arrives in a later UI phase."}
      />
      {children}
    </PageContainer>
  );
}
