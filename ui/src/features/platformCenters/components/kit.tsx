import type { ReactNode } from "react";
import { Button } from "../../../components/ui";
import { useT } from "../lib/useT";
import { qualityTone } from "../lib/tones";
import { ErrorPanel, Skeleton, Tag } from "./common";

export function Panel({ title, children, actions, testId }: { title?: string; children: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <section className="pc-panel" {...(testId ? { "data-testid": testId } : {})}>
      {title || actions ? (
        <div className="pc-header-row">
          {title ? <h2 className="pc-panel__title">{title}</h2> : <span />}
          {actions ? <div className="pc-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Loading / error / ready for one query; children render only with data. */
export function Async<T>({ query, children }: { query: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  const { tt } = useT();
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return null;
  return <>{children(query.data)}</>;
}

export function Cards({ items }: { items: { label: string; value: ReactNode; testId?: string }[] }) {
  return (
    <ul className="pc-cards">
      {items.map((item) => (
        <li key={item.label} className="pc-card" {...(item.testId ? { "data-testid": item.testId } : {})}>
          <span className="pc-card__label">{item.label}</span>
          <span className="pc-card__value">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Quality({ value }: { value: string }) {
  const { tt, label } = useT();
  return <Tag tone={qualityTone(value)} title={tt(`quality.${value}`)}>{label("quality", value)}</Tag>;
}

export interface Column<R> { key: string; header: string; render: (row: R) => ReactNode; wrap?: boolean }

/** An accessible table that scrolls inside its own box. */
export function DataTable<R>({ caption, columns, rows, rowKey, empty }: { caption: string; columns: Column<R>[]; rows: readonly R[]; rowKey: (row: R) => string; empty: string }) {
  if (rows.length === 0) return <div className="pc-empty"><p>{empty}</p></div>;
  return (
    <div className="pc-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="pc-table">
        <caption className="pc-visually-hidden">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>{columns.map((c) => <td key={c.key} className={c.wrap ? "pc-cell-wrap" : undefined}>{c.render(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A write control: when the viewer's role cannot use it, it is disabled AND says why. */
export function Guarded({ allowed, why, children }: { allowed: boolean; why: string; children: (disabled: boolean) => ReactNode }) {
  return (
    <span className="pc-inline" {...(!allowed ? { title: why } : {})}>
      {children(!allowed)}
      {!allowed ? <span className="pc-muted">{why}</span> : null}
    </span>
  );
}

export function Btn({ onClick, children, disabled, variant = "secondary", testId, size }: { onClick: () => void; children: ReactNode; disabled?: boolean; variant?: "primary" | "secondary" | "danger" | "ghost"; testId?: string; size?: "small" }) {
  return (
    <Button type="button" variant={variant} {...(size ? { size } : {})} onClick={onClick} {...(disabled !== undefined ? { disabled } : {})} {...(testId ? { "data-testid": testId } : {})}>{children}</Button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="pc-field"><span>{label}</span>{children}</label>;
}
