import type { ReactNode } from "react";
import "./PageContainer.css";

interface PageSectionProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  as?: "section" | "div";
  className?: string;
}

export default function PageSection({
  title,
  description,
  actions,
  children,
  as: Component = "section",
  className,
}: PageSectionProps) {
  return (
    <Component
      className={[
        "page-section",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {(title || description || actions) ? (
        <div className="page-section__header">
          <div className="page-section__heading">
            {title ? <h2 className="page-section__title">{title}</h2> : null}
            {description ? <p className="page-section__description">{description}</p> : null}
          </div>

          {actions ? <div className="page-section__actions">{actions}</div> : null}
        </div>
      ) : null}

      <div className="page-section__content">{children}</div>
    </Component>
  );
}
