import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, HelpCircle, Info, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "../../../components/ui";
import { PromptClientError } from "../api/promptClient";
import type { ValidationStatus } from "../types";
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
export function Tag({ tone = "neutral", children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`pi-tag pi-tag--${tone}`}>
      {icon ?? TONE_ICON[tone]}
      <span>{children}</span>
    </span>
  );
}

/** Each validation status has its own icon, tone and text. */
const STATUS_PRESENTATION: Record<ValidationStatus, { tone: Tone; icon: ReactNode }> = {
  PASS: { tone: "success", icon: <CheckCircle2 size={14} aria-hidden /> },
  WARN: { tone: "warning", icon: <AlertTriangle size={14} aria-hidden /> },
  CLARIFY: { tone: "info", icon: <HelpCircle size={14} aria-hidden /> },
  APPROVAL_REQUIRED: { tone: "warning", icon: <ShieldAlert size={14} aria-hidden /> },
  BLOCKED: { tone: "danger", icon: <Ban size={14} aria-hidden /> },
};

export function StatusTag({ status }: { status: ValidationStatus }) {
  const { label } = useT();
  const view = STATUS_PRESENTATION[status] ?? { tone: "neutral" as Tone, icon: undefined };
  return <Tag tone={view.tone} icon={view.icon}>{label("status", status)}</Tag>;
}

export function Unavailable() {
  const { tt } = useT();
  return <span className="pi-unavailable">{tt("common.unavailable")}</span>;
}

export function Text({ value }: { value: string | undefined | null }) {
  return value && value.trim().length > 0 ? <>{value}</> : <Unavailable />;
}

export function TextList({ items, emptyLabel }: { items: readonly string[] | undefined; emptyLabel?: string }) {
  const { tt } = useT();
  if (!items || items.length === 0) return <span className="pi-unavailable">{emptyLabel ?? tt("common.none")}</span>;
  return (
    <ul className="pi-list">
      {items.map((item, index) => <li key={`${index}-${item}`} className="pi-list__item">{item}</li>)}
    </ul>
  );
}

export function Section({ id, step, title, description, children }: {
  id: string;
  step?: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section className="pi-section" aria-labelledby={headingId} id={id}>
      <h3 id={headingId} className="pi-section__title">
        {step !== undefined ? <span className="pi-step" aria-hidden>{step}</span> : null}
        <span>{title}</span>
      </h3>
      {description ? <p className="pi-muted">{description}</p> : null}
      {children}
    </section>
  );
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="pi-deflist">
      {items.map((item) => (
        <div key={item.label} className="pi-deflist__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="pi-skeleton" aria-busy="true" role="status" aria-label={label}>
      <span className="pi-skeleton__bar" />
      <span className="pi-skeleton__bar pi-skeleton__bar--short" />
      <span className="pi-skeleton__bar" />
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
  const code = error instanceof PromptClientError ? error.code : "NETWORK";
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
    <div ref={ref} role="alert" tabIndex={-1} className="pi-alert pi-alert--danger" data-error-code={code}>
      <strong className="pi-alert__title">{tt(titleKey)}</strong>
      <p>{tt(bodyKey)}</p>
      <p className="pi-muted" data-testid="error-reason">{message}</p>
      {error instanceof PromptClientError && error.correlationId ? (
        <p className="pi-muted">{tt("error.reference", { id: error.correlationId })}</p>
      ) : null}
      <div className="pi-actions">
        {onRetry ? <Button type="button" variant="primary" onClick={onRetry}>{retryLabel ?? tt("common.retry")}</Button> : null}
        {onDismiss ? <Button type="button" onClick={onDismiss}>{tt("common.dismiss")}</Button> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <div className={`pi-alert pi-alert--${tone}`} role="note">
      {tone === "warning" ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}
      <div>{children}</div>
    </div>
  );
}
