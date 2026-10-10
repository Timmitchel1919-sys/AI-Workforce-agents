import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, Info, Loader2, PauseCircle, ShieldAlert, XCircle,
} from "lucide-react";
import { Button } from "../../../components/ui";
import { OrchClientError } from "../api/orchestrationClient";
import { useT } from "../lib/useT";
import type { OrchTaskStatus, RunStatus } from "../types";

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
    <span className={`eo-tag eo-tag--${tone}`}>
      {icon ?? TONE_ICON[tone]}
      <span>{children}</span>
    </span>
  );
}

interface Presentation { tone: Tone; icon: ReactNode }

const RUN_STATUS: Record<RunStatus, Presentation> = {
  NOT_STARTED: { tone: "neutral", icon: <CircleDashed size={14} aria-hidden /> },
  PLANNING: { tone: "info", icon: <Clock size={14} aria-hidden /> },
  EXECUTING: { tone: "info", icon: <Loader2 size={14} aria-hidden className="eo-spin" /> },
  BLOCKED: { tone: "danger", icon: <Ban size={14} aria-hidden /> },
  WAITING_APPROVAL: { tone: "warning", icon: <ShieldAlert size={14} aria-hidden /> },
  REVIEW: { tone: "info", icon: <Info size={14} aria-hidden /> },
  COMPLETED: { tone: "success", icon: <CheckCircle2 size={14} aria-hidden /> },
  FAILED: { tone: "danger", icon: <XCircle size={14} aria-hidden /> },
  CANCELLED: { tone: "neutral", icon: <PauseCircle size={14} aria-hidden /> },
};

const TASK_STATUS: Record<OrchTaskStatus, Presentation> = {
  PENDING: { tone: "neutral", icon: <CircleDashed size={14} aria-hidden /> },
  READY: { tone: "info", icon: <Clock size={14} aria-hidden /> },
  QUEUED: { tone: "info", icon: <Clock size={14} aria-hidden /> },
  RUNNING: { tone: "info", icon: <Loader2 size={14} aria-hidden className="eo-spin" /> },
  BLOCKED: { tone: "danger", icon: <Ban size={14} aria-hidden /> },
  WAITING_APPROVAL: { tone: "warning", icon: <ShieldAlert size={14} aria-hidden /> },
  REVIEW: { tone: "info", icon: <Info size={14} aria-hidden /> },
  FAILED: { tone: "danger", icon: <XCircle size={14} aria-hidden /> },
  RETRYING: { tone: "warning", icon: <Loader2 size={14} aria-hidden /> },
  COMPLETED: { tone: "success", icon: <CheckCircle2 size={14} aria-hidden /> },
  CANCELLED: { tone: "neutral", icon: <PauseCircle size={14} aria-hidden /> },
};

export function RunStatusTag({ status }: { status: RunStatus }) {
  const { label } = useT();
  const view = RUN_STATUS[status] ?? { tone: "neutral" as Tone, icon: undefined };
  return <Tag tone={view.tone} icon={view.icon}>{label("runStatus", status)}</Tag>;
}

export function TaskStatusTag({ status }: { status: OrchTaskStatus }) {
  const { label } = useT();
  const view = TASK_STATUS[status] ?? { tone: "neutral" as Tone, icon: undefined };
  return <Tag tone={view.tone} icon={view.icon}>{label("taskStatus", status)}</Tag>;
}

export function Unavailable() {
  const { tt } = useT();
  return <span className="eo-unavailable">{tt("common.unavailable")}</span>;
}

export function TextList({ items, emptyLabel }: { items: readonly string[] | undefined; emptyLabel?: string }) {
  const { tt } = useT();
  if (!items || items.length === 0) return <span className="eo-unavailable">{emptyLabel ?? tt("common.none")}</span>;
  return (
    <ul className="eo-list">
      {items.map((item, index) => <li key={`${index}-${item}`} className="eo-list__item">{item}</li>)}
    </ul>
  );
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="eo-deflist">
      {items.map((item) => (
        <div key={item.label} className="eo-deflist__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="eo-skeleton" aria-busy="true" role="status" aria-label={label}>
      <span className="eo-skeleton__bar" />
      <span className="eo-skeleton__bar eo-skeleton__bar--short" />
      <span className="eo-skeleton__bar" />
    </div>
  );
}

/** Every API failure is surfaced with its cause and can always be retried. Focus moves to it on appearance. */
export function ErrorPanel({ error, onRetry, retryLabel, onDismiss }: {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
}) {
  const { tt } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  const code = error instanceof OrchClientError ? error.code : "NETWORK";
  const message = error instanceof Error ? error.message : String(error);
  const bodyKey = {
    UNAUTHENTICATED: "error.unauthenticatedBody",
    FORBIDDEN: "error.forbiddenBody",
    NOT_FOUND: "error.notFoundBody",
    CONFLICT: "error.conflictBody",
    INVALID: "error.invalidBody",
    DEGRADED: "error.degradedBody",
    NETWORK: "error.networkBody",
  }[code];
  const titleKey = {
    UNAUTHENTICATED: "error.unauthenticatedTitle",
    FORBIDDEN: "error.forbiddenTitle",
    NOT_FOUND: "error.notFoundTitle",
    CONFLICT: "error.conflictTitle",
    INVALID: "error.invalidTitle",
    DEGRADED: "error.degradedTitle",
    NETWORK: "error.networkTitle",
  }[code];
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="eo-alert eo-alert--danger" data-error-code={code}>
      <strong className="eo-alert__title">{tt(titleKey)}</strong>
      <p>{tt(bodyKey)}</p>
      <p className="eo-muted" data-testid="error-reason">{message}</p>
      {error instanceof OrchClientError && error.correlationId ? (
        <p className="eo-muted">{tt("error.reference", { id: error.correlationId })}</p>
      ) : null}
      <div className="eo-actions">
        {onRetry ? <Button type="button" variant="primary" onClick={onRetry}>{retryLabel ?? tt("common.retry")}</Button> : null}
        {onDismiss ? <Button type="button" onClick={onDismiss}>{tt("common.dismiss")}</Button> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning"; title?: string; children: ReactNode }) {
  return (
    <div className={`eo-alert eo-alert--${tone}`} role="note">
      {tone === "warning" ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}
      <div>
        {title ? <strong>{title}</strong> : null}
        <p>{children}</p>
      </div>
    </div>
  );
}

export function ProgressBar({ completed, total, percent }: { completed: number; total: number; percent: number }) {
  const { tt } = useT();
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const text = total > 0 ? tt("progress.text", { completed, total, percent: pct }) : tt("progress.noTasks");
  return (
    <div className="eo-progress">
      <div
        className="eo-progress__track"
        role="progressbar"
        aria-label={tt("progress.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={text}
      >
        <span className="eo-progress__fill" style={{ inlineSize: `${pct}%` }} />
      </div>
      <span className="eo-progress__text">{text}</span>
    </div>
  );
}
