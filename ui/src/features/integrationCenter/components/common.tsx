import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react";
import { Button } from "../../../components/ui";
import { IntegrationClientError, errorCode } from "../api/integrationClient";
import { eventTone, outcomeTone, riskTone, statusTone, type ToneName } from "../lib/logic";
import { useT } from "../lib/useT";
import type { Report } from "./report";

export type Tone = ToneName;

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
    <span className={`ic-tag ic-tag--${tone}`} {...(title ? { title } : {})}>
      {TONE_ICON[tone]}
      <span>{children}</span>
    </span>
  );
}

export function StatusTag({ status }: { status: string }) {
  const { label } = useT();
  return <Tag tone={statusTone(status)}>{label("status", status)}</Tag>;
}
export function RiskTag({ value }: { value: string }) {
  const { label } = useT();
  return <Tag tone={riskTone(value)}>{label("risk", value)}</Tag>;
}
export function OutcomeTag({ value }: { value: string }) {
  const { label } = useT();
  return <Tag tone={outcomeTone(value)}>{label("outcome", value)}</Tag>;
}
export function EventStatusTag({ value }: { value: string }) {
  const { label } = useT();
  return <Tag tone={eventTone(value)}>{label("eventStatus", value)}</Tag>;
}
/** LIVE is a warning (it acts on real data); SANDBOX is informational. */
export function ModeTag({ mode }: { mode: string }) {
  const { label } = useT();
  return <Tag tone={mode === "LIVE" ? "warning" : "info"}>{label("mode", mode)}</Tag>;
}

export function Unavailable() {
  const { tt } = useT();
  return <span className="ic-unavailable">{tt("common.unavailable")}</span>;
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="ic-deflist">
      {items.map((item) => (
        <div key={item.label} className="ic-deflist__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="ic-skeleton" aria-busy="true" role="status" aria-label={label}>
      <span className="ic-skeleton__bar" />
      <span className="ic-skeleton__bar ic-skeleton__bar--short" />
      <span className="ic-skeleton__bar" />
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
    <div ref={ref} role="alert" tabIndex={-1} className="ic-alert ic-alert--danger" data-error-code={code}>
      <strong className="ic-alert__title">{tt(`error.${key}Title`)}</strong>
      <p>{tt(`error.${key}Body`)}</p>
      <p className="ic-muted" data-testid="error-reason">{message}</p>
      {error instanceof IntegrationClientError && error.correlationId ? <p className="ic-muted">{tt("error.reference", { id: error.correlationId })}</p> : null}
      {onRetry ? (
        <div className="ic-actions">
          <Button type="button" variant="primary" onClick={onRetry}>{tt("common.retry")}</Button>
        </div>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "success"; title?: string; children: ReactNode }) {
  return (
    <div className={`ic-alert ic-alert--${tone}`} role={tone === "success" ? "status" : "note"}>
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
    <div className="ic-empty">
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

/** Renders any server-provided value as plain text (never HTML): primitives, lists and nested objects. */
export function Readable({ value }: { value: unknown }) {
  const { tt } = useT();
  if (value === null || value === undefined) return <Unavailable />;
  if (typeof value === "boolean") return <span>{value ? tt("common.yes") : tt("common.no")}</span>;
  if (typeof value === "string" || typeof value === "number") return <span className="ic-text">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="ic-muted">{tt("common.none")}</span>;
    return (
      <ul className="ic-list">
        {value.map((item, index) => <li key={index}><Readable value={item} /></li>)}
      </ul>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="ic-muted">{tt("common.none")}</span>;
  return <DefList items={entries.map(([key, v]) => ({ label: key, value: <Readable value={v} /> }))} />;
}

export function TextList({ items }: { items: readonly string[] | undefined }) {
  const { tt } = useT();
  if (!items || items.length === 0) return <span className="ic-muted">{tt("common.none")}</span>;
  return <span className="ic-text">{items.join(", ")}</span>;
}

/* ------------------------------------------------------------------ */
/* Result reporting: the outcome of a direct action is announced politely */
/* ------------------------------------------------------------------ */

/** One live region for the last direct-action result. Errors are `alert`, everything else `status`. */
export function ReportBanner({ report, onDismiss }: { report: Report | null; onDismiss: () => void }) {
  const { tt } = useT();
  return (
    <div aria-live="polite" aria-atomic="true" className="ic-report-region">
      {report ? (
        <div className={`ic-alert ic-alert--${report.tone === "danger" ? "danger" : report.tone}`} role={report.tone === "danger" ? "alert" : "status"} data-testid="report">
          <div>
            <strong>{report.title ?? tt("report.title")}</strong>
            <p className="ic-text" data-testid="report-message">{report.message}</p>
            {report.checks && report.checks.length > 0 ? (
              <ul className="ic-list" aria-label={tt("detail.securityTitle")}>
                {report.checks.map((c) => (
                  <li key={c.check}>
                    <Tag tone={c.ok ? "success" : "danger"}>{c.ok ? tt("report.checkPassed") : tt("report.checkFailed")}</Tag> <strong>{c.check}</strong>{" "}
                    <span className="ic-muted">{c.detail}</span>
                  </li>
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
