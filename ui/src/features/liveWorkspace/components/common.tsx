import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, Info, Loader2, PauseCircle, ShieldAlert, XCircle,
} from "lucide-react";
import { Button } from "../../../components/ui";
import { RuntimeClientError, errorCode } from "../api/runtimeClient";
import { useT } from "../lib/useT";
import type { RuntimeState } from "../types";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_ICON: Record<Tone, ReactNode> = {
  neutral: <CircleDashed size={14} aria-hidden />,
  success: <CheckCircle2 size={14} aria-hidden />,
  warning: <AlertTriangle size={14} aria-hidden />,
  danger: <XCircle size={14} aria-hidden />,
  info: <Info size={14} aria-hidden />,
};

/** Status is always icon + text, never colour alone. */
export function Tag({ tone = "neutral", children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`lw-tag lw-tag--${tone}`}>
      {icon ?? TONE_ICON[tone]}
      <span>{children}</span>
    </span>
  );
}

const STATE_VIEW: Record<RuntimeState, { tone: Tone; icon: ReactNode }> = {
  CREATED: { tone: "neutral", icon: <CircleDashed size={14} aria-hidden /> },
  INITIALIZING: { tone: "info", icon: <Loader2 size={14} aria-hidden className="lw-spin" /> },
  READY: { tone: "info", icon: <Clock size={14} aria-hidden /> },
  RUNNING: { tone: "info", icon: <Loader2 size={14} aria-hidden className="lw-spin" /> },
  PAUSED: { tone: "warning", icon: <PauseCircle size={14} aria-hidden /> },
  WAITING_APPROVAL: { tone: "warning", icon: <ShieldAlert size={14} aria-hidden /> },
  REVIEWING: { tone: "info", icon: <Info size={14} aria-hidden /> },
  SUCCEEDED: { tone: "success", icon: <CheckCircle2 size={14} aria-hidden /> },
  FAILED: { tone: "danger", icon: <XCircle size={14} aria-hidden /> },
  CANCELLED: { tone: "neutral", icon: <Ban size={14} aria-hidden /> },
  TIMED_OUT: { tone: "danger", icon: <Clock size={14} aria-hidden /> },
};

export function StatusTag({ status }: { status: RuntimeState }) {
  const { label } = useT();
  const view = STATE_VIEW[status] ?? { tone: "neutral" as Tone, icon: undefined };
  return <Tag tone={view.tone} icon={view.icon}>{label("state", status)}</Tag>;
}

export function Unavailable() {
  const { tt } = useT();
  return <span className="lw-unavailable">{tt("common.unavailable")}</span>;
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="lw-deflist">
      {items.map((item) => (
        <div key={item.label} className="lw-deflist__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="lw-skeleton" aria-busy="true" role="status" aria-label={label}>
      <span className="lw-skeleton__bar" />
      <span className="lw-skeleton__bar lw-skeleton__bar--short" />
      <span className="lw-skeleton__bar" />
    </div>
  );
}

/** Every API failure is surfaced with its cause and can always be retried. */
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
    <div ref={ref} role="alert" tabIndex={-1} className="lw-alert lw-alert--danger" data-error-code={code}>
      <strong className="lw-alert__title">{tt(`error.${key}Title`)}</strong>
      <p>{tt(`error.${key}Body`)}</p>
      <p className="lw-muted" data-testid="error-reason">{message}</p>
      {error instanceof RuntimeClientError && error.correlationId ? (
        <p className="lw-muted">{tt("error.reference", { id: error.correlationId })}</p>
      ) : null}
      {onRetry ? (
        <div className="lw-actions">
          <Button type="button" variant="primary" onClick={onRetry}>{tt("common.retry")}</Button>
        </div>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning"; title?: string; children: ReactNode }) {
  return (
    <div className={`lw-alert lw-alert--${tone}`} role="note">
      {tone === "warning" ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}
      <div>
        {title ? <strong>{title}</strong> : null}
        <p>{children}</p>
      </div>
    </div>
  );
}
