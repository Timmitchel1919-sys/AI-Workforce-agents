import "./ui.css";

export interface PaginationProps {
  current: number;
  total: number;
  onChange?: (page: number) => void;
}

export function Pagination({ current, total, onChange }: PaginationProps) {
  return (
    <nav aria-label="Pagination">
      <button onClick={() => onChange?.(current - 1)} disabled={current <= 1}>Previous</button>
      <span aria-live="polite">{current} / {total}</span>
      <button onClick={() => onChange?.(current + 1)} disabled={current >= total}>Next</button>
    </nav>
  );
}

export default Pagination;
