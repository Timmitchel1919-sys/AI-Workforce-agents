import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, FileEdit, Info, XCircle } from "lucide-react";
import { Button } from "../../../components/ui";
import { KnowledgeClientError, errorCode } from "../api/knowledgeClient";
import { useT } from "../lib/useT";
import type { Freshness, MemoryStatus } from "../types";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_ICON: Record<Tone, ReactNode> = {
  neutral: <CircleDashed size={14} aria-hidden />,
  success: <CheckCircle2 size={14} aria-hidden />,
  warning: <AlertTriangle size={14} aria-hidden />,
  danger: <XCircle size={14} aria-hidden />,
  info: <Info size={14} aria-hidden />,
};

/** Status is always icon + text, never colour alone. */
export function Tag({ tone = "neutral", children, icon, title }: { tone?: Tone; children: ReactNode; icon?: ReactNode; title?: string }) {
  return (
    <span className={`kn-tag kn-tag--${tone}`} {...(title ? { title } : {})}>
      {icon ?? TONE_ICON[tone]}
      <span>{children}</span>
    </span>
  );
}

const STATUS_VIEW: Record<MemoryStatus, { tone: Tone; icon: ReactNode }> = {
  DRAFT: { tone: "info", icon: <FileEdit size={14} aria-hidden /> },
  ACTIVE: { tone: "success", icon: <CheckCircle2 size={14} aria-hidden /> },
  SUPERSEDED: { tone: "warning", icon: <Clock size={14} aria-hidden /> },
  ARCHIVED: { tone: "neutral", icon: <Ban size={14} aria-hidden /> },
  REVOKED: { tone: "danger", icon: <XCircle size={14} aria-hidden /> },
};

export function StatusTag({ status }: { status: MemoryStatus }) {
  const { label } = useT();
  const view = STATUS_VIEW[status] ?? { tone: "neutral" as Tone, icon: undefined };
  return <Tag tone={view.tone} icon={view.icon}>{label("status", status)}</Tag>;
}

export function FreshnessTag({ freshness }: { freshness: Freshness }) {
  const { label } = useT();
  return freshness === "POTENTIALLY_STALE"
    ? <Tag tone="warning">{label("freshness", freshness)}</Tag>
    : <Tag tone="success">{label("freshness", freshness)}</Tag>;
}

export function Unavailable() {
  const { tt } = useT();
  return <span className="kn-unavailable">{tt("common.unavailable")}</span>;
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kn-deflist">
      {items.map((item) => (
        <div key={item.label} className="kn-deflist__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="kn-skeleton" aria-busy="true" role="status" aria-label={label}>
      <span className="kn-skeleton__bar" />
      <span className="kn-skeleton__bar kn-skeleton__bar--short" />
      <span className="kn-skeleton__bar" />
    </div>
  );
}

/** Every API failure is surfaced with its cause (the server's own message) and can be retried. */
export function ErrorPanel({ error, onRetry, focus = false }: { error: unknown; onRetry?: () => void; focus?: boolean }) {
  const { tt } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error && focus) ref.current?.focus();
  }, [error, focus]);
  if (!error) return null;
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const key = {
    UNAUTHENTICATED: "unauthenticated", FORBIDDEN: "forbidden", NOT_FOUND: "notFound", CONFLICT: "conflict",
    INVALID: "invalid", DEGRADED: "degraded", NETWORK: "network",
  }[code];
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="kn-alert kn-alert--danger" data-error-code={code}>
      <strong className="kn-alert__title">{tt(`error.${key}Title`)}</strong>
      <p>{tt(`error.${key}Body`)}</p>
      <p className="kn-muted" data-testid="error-reason">{message}</p>
      {error instanceof KnowledgeClientError && error.correlationId ? (
        <p className="kn-muted">{tt("error.reference", { id: error.correlationId })}</p>
      ) : null}
      {onRetry ? (
        <div className="kn-actions">
          <Button type="button" variant="primary" onClick={onRetry}>{tt("common.retry")}</Button>
        </div>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "success"; title?: string; children: ReactNode }) {
  return (
    <div className={`kn-alert kn-alert--${tone}`} role={tone === "success" ? "status" : "note"}>
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
    <div className="kn-empty">
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
