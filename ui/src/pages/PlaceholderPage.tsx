import type { ReactNode } from "react";
import { PageFrame } from "../components/layout";

/**
 * Route placeholder — proves route + shell + page-frame wiring. The real page
 * arrives in a later UI phase; UI-2 built the primitives, UI-3 the shell.
 * The document title is set by `ControlCenterLayout` from route metadata.
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
  return (
    <PageFrame
      title={title}
      description={description ?? "This view arrives in a later UI phase."}
    >
      {children}
    </PageFrame>
  );
}
