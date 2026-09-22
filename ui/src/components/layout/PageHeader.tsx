import type { ReactNode } from "react";
import { Breadcrumb } from "../ui";
import type { BreadcrumbItem } from "../ui/Breadcrumb";
import "./PageContainer.css";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  breadcrumbs,
  actions,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <div className="page-header__breadcrumbs">
          <Breadcrumb items={breadcrumbs} />
        </div>
      ) : null}

      {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}

      <div className="page-header__row">
        <div className="page-header__content">
          <h1 className="page-header__title">{title}</h1>
          {description ? <p className="page-header__description">{description}</p> : null}
        </div>

        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
