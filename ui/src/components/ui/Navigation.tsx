import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "./icons";
import { Button } from "./Button";
import { cn } from "../../lib/utils";

/* ---- Tabs ------------------------------------------------------------- */
export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
  content: ReactNode;
}

export function Tabs({
  items,
  defaultTab,
  label = "Tabs",
}: {
  items: readonly TabItem[];
  defaultTab?: string;
  label?: string;
}) {
  const baseId = useId();
  const [active, setActive] = useState(defaultTab ?? items[0]?.id);
  const activeItem = items.find((i) => i.id === active) ?? items[0];

  return (
    <div className="ui-tabs">
      <div className="ui-tabs__list" role="tablist" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            id={`${baseId}-tab-${item.id}`}
            aria-selected={item.id === activeItem?.id}
            aria-controls={`${baseId}-panel-${item.id}`}
            tabIndex={item.id === activeItem?.id ? 0 : -1}
            className="ui-tabs__tab"
            disabled={item.disabled}
            onClick={() => setActive(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {activeItem ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeItem.id}`}
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          className="ui-tabs__panel"
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
}

/* ---- Breadcrumb ------------------------------------------------- */
export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav className="ui-breadcrumb" aria-label="Breadcrumb">
      {items.map((crumb, index) => {
        const last = index === items.length - 1;
        return (
          <span
            key={`${crumb.label}-${index}`}
            className="ui-inline"
            style={{ gap: "var(--space-xs)" }}
          >
            {index > 0 ? (
              <ChevronRight className="ui-breadcrumb__sep" aria-hidden="true" />
            ) : null}
            {last || !crumb.to ? (
              <span
                className="ui-breadcrumb__current"
                aria-current={last ? "page" : undefined}
              >
                {crumb.label}
              </span>
            ) : (
              <Link to={crumb.to} className="ui-breadcrumb__link">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/* ---- Pagination ---------------------------------------------- */
export interface PaginationProps {
  page: number;
  pageCount?: number;
  total?: number;
  pageSize?: number;
  onPrev: () => void;
  onNext: () => void;
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPrev,
  onNext,
}: PaginationProps) {
  const from =
    total != null && pageSize != null ? (page - 1) * pageSize + 1 : undefined;
  const to =
    total != null && pageSize != null
      ? Math.min(page * pageSize, total)
      : undefined;
  const hasNext = pageCount != null ? page < pageCount : true;

  return (
    <div className={cn("ui-pagination")}>
      <Button
        size="sm"
        variant="outline"
        iconLeft={ChevronLeft}
        onClick={onPrev}
        disabled={page <= 1}
      >
        Prev
      </Button>
      <span className="ui-pagination__range">
        {from != null && to != null && total != null
          ? `${from}–${to} of ${total}`
          : `Page ${page}${pageCount ? ` of ${pageCount}` : ""}`}
      </span>
      <Button
        size="sm"
        variant="outline"
        iconRight={ChevronRight}
        onClick={onNext}
        disabled={!hasNext}
      >
        Next
      </Button>
    </div>
  );
}
