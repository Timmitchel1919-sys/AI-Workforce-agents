import type { CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "../../lib/utils";

type Gap = "none" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
const GAP: Record<Gap, string> = {
  none: "0",
  "2xs": "var(--space-2xs)",
  xs: "var(--space-xs)",
  sm: "var(--space-sm)",
  md: "var(--space-md)",
  lg: "var(--space-lg)",
  xl: "var(--space-xl)",
  "2xl": "var(--space-2xl)",
};

/* ---- PageContainer -------------------------------------------------- */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("ui-page", className)}>{children}</div>;
}

/* ---- PageHeader -------------------------------------------------- */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__titles">
        <h1 className="ui-page-header__title">{title}</h1>
        {description ? (
          <p className="ui-page-header__description">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="ui-page-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}

/* ---- Section -------------------------------------------------- */
export function Section({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ui-section">
      {title || actions ? (
        <div className="ui-section__head">
          {title ? <h2 className="ui-section__title">{title}</h2> : <span />}
          {actions ? <div className="ui-inline">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* ---- Toolbar -------------------------------------------------- */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="ui-toolbar">{children}</div>;
}
export function ToolbarSpacer() {
  return <span className="ui-toolbar__spacer" />;
}

/* ---- Stack / Inline -------------------------------------------- */
export function Stack({
  gap = "md",
  as: As = "div",
  className,
  children,
}: {
  gap?: Gap;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <As className={cn("ui-stack", className)} style={{ gap: GAP[gap] }}>
      {children}
    </As>
  );
}

export function Inline({
  gap = "sm",
  wrap = true,
  align = "center",
  className,
  children,
}: {
  gap?: Gap;
  wrap?: boolean;
  align?: CSSProperties["alignItems"];
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("ui-inline", !wrap && "ui-inline--nowrap", className)}
      style={{ gap: GAP[gap], alignItems: align }}
    >
      {children}
    </div>
  );
}

/* ---- Grid -------------------------------------------------- */
export function Grid({
  min = "220px",
  gap = "md",
  className,
  children,
}: {
  min?: string;
  gap?: Gap;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("ui-grid", className)}
      style={{
        gap: GAP[gap],
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}
