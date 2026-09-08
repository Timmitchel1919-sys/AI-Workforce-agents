import type { ReactNode } from "react";
import { ArrowUpDown } from "./icons";
import { Skeleton } from "./Feedback";
import { EmptyState } from "./Feedback";
import { cn } from "../../lib/utils";

export type SortDirection = "ascending" | "descending" | "none";

export interface Column<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Enables the sort affordance in the header. UI only in UI-2. */
  sortable?: boolean;
  width?: string;
  align?: "left" | "right";
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<Column<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  caption?: string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDetail?: string;
  selectedIds?: ReadonlySet<string>;
  onRowClick?: (row: Row) => void;
  sort?: { columnId: string; direction: SortDirection };
  onSortChange?: (columnId: string) => void;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  emptyTitle = "Nothing to show",
  emptyDetail,
  selectedIds,
  onRowClick,
  sort,
  onSortChange,
}: DataTableProps<Row>) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        {caption ? (
          <caption className="visually-hidden">{caption}</caption>
        ) : null}
        <thead>
          <tr>
            {columns.map((col) => {
              const isSorted = sort?.columnId === col.id;
              const ariaSort: SortDirection | undefined = col.sortable
                ? isSorted
                  ? sort!.direction
                  : "none"
                : undefined;
              return (
                <th
                  key={col.id}
                  scope="col"
                  style={{ width: col.width, textAlign: col.align }}
                  aria-sort={ariaSort}
                  onClick={
                    col.sortable && onSortChange
                      ? () => onSortChange(col.id)
                      : undefined
                  }
                >
                  {col.header}
                  {col.sortable ? (
                    <ArrowUpDown
                      className="ui-table__sort"
                      aria-hidden="true"
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr className="ui-table__loading">
              <td colSpan={columns.length}>
                <Skeleton variant="text" count={4} width="60%" />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr className="ui-table__empty">
              <td colSpan={columns.length}>
                <EmptyState title={emptyTitle} detail={emptyDetail} />
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  aria-selected={selectedIds?.has(key) || undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && "ui-table__row--clickable")}
                >
                  {columns.map((col) => (
                    <td key={col.id} style={{ textAlign: col.align }}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
