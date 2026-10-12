import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react";
import { Button } from "../../../components/ui";
import { ApiClientError, errorCode } from "../api/http";
import { useT } from "../lib/useT";
import type { Report } from "./report";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_ICON: Record<Tone, ReactNode> = {
  neutral: <CircleDashed size={14} aria-hidden />,
  success: <CheckCircle2 size={14} aria-hidden />,
  warning: <AlertTriangle size={14} aria-hidden />,
  danger: <XCircle size={14} aria-hidden />,
  info: <Info size={14} aria-hidden />,
};

/** Status is always icon + text, never colour alone. */
export function Tag({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`pc-tag pc-tag--${tone}`} {...(title ? { title } : {})}>
      {TONE_ICON[tone]}
      <span>{children}</span>
    </span>
  );
}

/** A backend enum value rendered with its translated label and a tone. */
export function EnumTag({ group, value, tone }: { group: string; value: string; tone: Tone }) {
  const { label } = useT();
  return <Tag tone={tone}>{label(group, value)}</Tag>;
}

export function Unavailable({ text }: { text?: string }) {
  const { tt } = useT();
  return <span className="pc-unavailable">{text ?? tt("common.unavailable")}</span>;
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="pc-deflist">
      {items.map((item) => (
        <div key={item.label} className="pc-deflist__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="pc-skeleton" aria-busy="true" role="status" aria-label={label}>
      <span className="pc-skeleton__bar" />
      <span className="pc-skeleton__bar pc-skeleton__bar--short" />
      <span className="pc-skeleton__bar" />
    </div>
  );
}

/** Every API failure is surfaced with its cause (the server's own message) and can be retried. */
export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { tt } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const key = {
    UNAUTHENTICATED: "unauthenticated", FORBIDDEN: "forbidden", NOT_FOUND: "notFound", CONFLICT: "conflict",
    INVALID: "invalid", DEGRADED: "degraded", NETWORK: "network",
  }[code];
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="pc-alert pc-alert--danger" data-error-code={code}>
      <strong className="pc-alert__title">{tt(`error.${key}Title`)}</strong>
      <p>{tt(`error.${key}Body`)}</p>
      <p className="pc-muted" data-testid="error-reason">{message}</p>
      {error instanceof ApiClientError && error.correlationId ? <p className="pc-muted">{tt("error.reference", { id: error.correlationId })}</p> : null}
      {onRetry ? (
        <div className="pc-actions">
          <Button type="button" variant="primary" onClick={onRetry}>{tt("common.retry")}</Button>
        </div>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children, testId }: { tone?: "info" | "warning" | "success"; title?: string; children: ReactNode; testId?: string }) {
  return (
    <div className={`pc-alert pc-alert--${tone}`} role={tone === "success" ? "status" : "note"} {...(testId ? { "data-testid": testId } : {})}>
      {tone === "warning" ? <AlertTriangle size={16} aria-hidden /> : tone === "success" ? <CheckCircle2 size={16} aria-hidden /> : <Info size={16} aria-hidden />}
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="pc-empty">
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

/** Renders a list of plain strings (never HTML); "none" when empty. */
export function TextList({ items }: { items: readonly string[] | undefined }) {
  const { tt } = useT();
  if (!items || items.length === 0) return <span className="pc-muted">{tt("common.none")}</span>;
  return <span className="pc-text">{items.join(", ")}</span>;
}

/** Renders any server-provided value as plain text (never HTML): primitives, lists and nested objects. */
export function Readable({ value }: { value: unknown }) {
  const { tt } = useT();
  if (value === null || value === undefined) return <Unavailable />;
  if (typeof value === "boolean") return <span>{value ? tt("common.yes") : tt("common.no")}</span>;
  if (typeof value === "string" || typeof value === "number") return <span className="pc-text">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="pc-muted">{tt("common.none")}</span>;
    return (
      <ul className="pc-list">
        {value.map((item, index) => <li key={index}><Readable value={item} /></li>)}
      </ul>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="pc-muted">{tt("common.none")}</span>;
  return <DefList items={entries.map(([key, v]) => ({ label: key, value: <Readable value={v} /> }))} />;
}

/** One live region for the last direct-action result. Errors are `alert`, everything else `status`. */
export function ReportBanner({ report, onDismiss }: { report: Report | null; onDismiss: () => void }) {
  const { tt } = useT();
  return (
    <div aria-live="polite" aria-atomic="true" className="pc-report-region">
      {report ? (
        <div className={`pc-alert pc-alert--${report.tone}`} role={report.tone === "danger" ? "alert" : "status"} data-testid="report">
          <div>
            <strong>{report.title ?? tt("report.title")}</strong>
            <p className="pc-text" data-testid="report-message">{report.message}</p>
            {report.lines && report.lines.length > 0 ? (
              <ul className="pc-list" data-testid="report-lines">
                {report.lines.map((line) => (
                  <li key={line.key}><Tag tone={line.tone}>{line.text}</Tag></li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button type="button" variant="ghost" size="small" onClick={onDismiss}>{tt("common.close")}</Button>
        </div>
      ) : null}
    </div>
  );
}
