import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react";
import { Button } from "../../../components/ui";
import { TrustClientError, errorCode } from "../api/trustClient";
import { riskTone } from "../lib/logic";
import { useT } from "../lib/useT";

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
    <span className={`sc-tag sc-tag--${tone}`} {...(title ? { title } : {})}>
      {TONE_ICON[tone]}
      <span>{children}</span>
    </span>
  );
}


export function RiskTag({ value }: { value: string }) {
  const { label } = useT();
  return <Tag tone={riskTone(value)}>{label("risk", value)}</Tag>;
}

export function Unavailable() {
  const { tt } = useT();
  return <span className="sc-unavailable">{tt("common.unavailable")}</span>;
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="sc-deflist">
      {items.map((item) => (
        <div key={item.label} className="sc-deflist__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="sc-skeleton" aria-busy="true" role="status" aria-label={label}>
      <span className="sc-skeleton__bar" />
      <span className="sc-skeleton__bar sc-skeleton__bar--short" />
      <span className="sc-skeleton__bar" />
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
    <div ref={ref} role="alert" tabIndex={-1} className="sc-alert sc-alert--danger" data-error-code={code}>
      <strong className="sc-alert__title">{tt(`error.${key}Title`)}</strong>
      <p>{tt(`error.${key}Body`)}</p>
      <p className="sc-muted" data-testid="error-reason">{message}</p>
      {error instanceof TrustClientError && error.correlationId ? <p className="sc-muted">{tt("error.reference", { id: error.correlationId })}</p> : null}
      {onRetry ? (
        <div className="sc-actions">
          <Button type="button" variant="primary" onClick={onRetry}>{tt("common.retry")}</Button>
        </div>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "success"; title?: string; children: ReactNode }) {
  return (
    <div className={`sc-alert sc-alert--${tone}`} role={tone === "success" ? "status" : "note"}>
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
    <div className="sc-empty">
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

/** Shown when a tab needs exactly one project but the scope is "All projects". */
export function NeedsProject() {
  const { tt } = useT();
  return <Empty title={tt("scope.needsProjectTitle")} body={tt("scope.needsProjectBody")} />;
}

/** Renders any server-provided value as plain text (never HTML): primitives, lists and nested objects. */
export function Readable({ value }: { value: unknown }) {
  const { tt } = useT();
  if (value === null || value === undefined) return <Unavailable />;
  if (typeof value === "boolean") return <span>{value ? tt("common.yes") : tt("common.no")}</span>;
  if (typeof value === "string" || typeof value === "number") return <span className="sc-text">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="sc-muted">{tt("common.none")}</span>;
    return (
      <ul className="sc-list">
        {value.map((item, index) => <li key={index}><Readable value={item} /></li>)}
      </ul>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="sc-muted">{tt("common.none")}</span>;
  return <DefList items={entries.map(([key, v]) => ({ label: key, value: <Readable value={v} /> }))} />;
}

export function TextList({ items }: { items: readonly string[] | undefined }) {
  const { tt } = useT();
  if (!items || items.length === 0) return <span className="sc-muted">{tt("common.none")}</span>;
  return <span className="sc-text">{items.join(", ")}</span>;
}
