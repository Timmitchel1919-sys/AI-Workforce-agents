import type { ReactNode } from "react";
import { Breadcrumb } from "../ui";
import type { BreadcrumbItem } from "../ui/Breadcrumb";
import BackButton from "./BackButton";
import "./PageContainer.css";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  /** Back button destination; default is browser history (parent route fallback). */
  backTo?: string;
  backLabel?: string;
  /** Hide the back button (e.g. when the page renders its own). Default true. */
  showBack?: boolean;
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  breadcrumbs,
  actions,
  backTo,
  backLabel,
  showBack = true,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      {showBack ? (
        <div className="page-header__back">
          <BackButton to={backTo} label={backLabel} />
        </div>
      ) : null}

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
