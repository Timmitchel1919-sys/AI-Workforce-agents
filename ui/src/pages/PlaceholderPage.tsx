import type { ReactNode } from "react";
import { PageHeader } from "../components/ui";
import { useDocumentTitle } from "../hooks";

/**
 * UI-1 route placeholder. Proves the route + layout + title wiring works; the
 * real page arrives in a later UI phase.
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
    <section className="page">
      <PageHeader
        title={title}
        description={description ?? "This view arrives in a later UI phase."}
      />
      {children}
    </section>
  );
}
