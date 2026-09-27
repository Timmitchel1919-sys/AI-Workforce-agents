import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, Loader2, XCircle } from "lucide-react";
import { Button } from "../../../components/ui";
import { OnboardingClientError } from "../api/onboardingClient";
import type { EvidenceConfidence, Finding } from "../types";
import { useT } from "../lib/useT";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "running";

const TONE_ICON: Record<Tone, ReactNode> = {
  neutral: <CircleDashed size={14} aria-hidden />,
  success: <CheckCircle2 size={14} aria-hidden />,
  warning: <AlertTriangle size={14} aria-hidden />,
  danger: <XCircle size={14} aria-hidden />,
  info: <Info size={14} aria-hidden />,
  running: <Loader2 size={14} aria-hidden className="ob-spin" />,
};

/** Status is always icon + text, never colour alone. */
export function Tag({ tone = "neutral", children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`ob-tag ob-tag--${tone}`}>
      {icon ?? TONE_ICON[tone]}
      <span>{children}</span>
    </span>
  );
}

export function Section({ id, title, description, children, actions }: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className="ob-section" aria-labelledby={headingId} id={id}>
      <div className="ob-section__head">
        <h3 id={headingId} className="ob-section__title">{title}</h3>
        {actions}
      </div>
      {description ? <p className="ob-muted">{description}</p> : null}
      {children}
    </section>
  );
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="ob-deflist">
      {items.map((item) => (
        <div key={item.label} className="ob-deflist__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Unavailable() {
  const { tt } = useT();
  return <span className="ob-unavailable">{tt("common.unavailable")}</span>;
}

const CONFIDENCE_TONE: Record<EvidenceConfidence, Tone> = { high: "success", medium: "info", low: "warning" };

/** Each finding shows its evidence and confidence; an empty list is stated, never faked. */
export function FindingList({ findings, emptyLabel }: { findings: readonly Finding[] | undefined; emptyLabel?: string }) {
  const { tt } = useT();
  if (!findings || findings.length === 0) {
    return <span className="ob-unavailable">{emptyLabel ?? tt("common.notEstablished")}</span>;
  }
  return (
    <ul className="ob-list">
      {findings.map((f, i) => (
        <li key={`${f.value}-${i}`} className="ob-list__item">
          <span className="ob-strong">{f.value}</span>{" "}
          <Tag tone={CONFIDENCE_TONE[f.confidence]}>{tt(`confidence.${f.confidence}`)}</Tag>
          <div className="ob-muted ob-evidence">{tt("common.evidence")}: {f.evidence}</div>
        </li>
      ))}
    </ul>
  );
}

/** Error summary: role="alert", focused when it appears so screen readers announce it. */
export function ErrorSummary({ title, items }: { title: string; items: { id: string; message: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const signature = items.map((i) => i.id + i.message).join("|");
  useEffect(() => {
    if (items.length > 0) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refocus only when the set of errors changes
  }, [signature]);
  if (items.length === 0) return null;
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="ob-error-summary">
      <h3 className="ob-error-summary__title">{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(item.id)?.focus();
              }}
            >
              {item.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every API failure is surfaced with its cause; a conflict offers "reload latest". */
export function CommandError({ error, onReload, onDismiss }: {
  error: unknown;
  onReload?: () => void;
  onDismiss?: () => void;
}) {
  const { tt } = useT();
  if (!error) return null;
  const code = error instanceof OnboardingClientError ? error.code : "NETWORK";
  const message = error instanceof Error ? error.message : String(error);
  const titleKey =
    code === "CONFLICT" ? "error.conflictTitle"
      : code === "DUPLICATE" ? "error.duplicateTitle"
        : code === "FORBIDDEN" ? "error.forbiddenTitle"
          : code === "UNAUTHENTICATED" ? "error.unauthenticatedTitle"
            : code === "NOT_FOUND" ? "error.notFoundTitle"
              : code === "INVALID" ? "error.invalidTitle"
                : "error.genericTitle";
  const bodyKey =
    code === "CONFLICT" ? "error.conflictBody"
      : code === "DUPLICATE" ? "error.duplicateBody"
        : code === "FORBIDDEN" ? "error.forbiddenBody"
          : code === "UNAUTHENTICATED" ? "error.unauthenticatedBody"
            : undefined;
  return (
    <div role="alert" className="ob-alert ob-alert--danger" data-error-code={code}>
      <strong>{tt(titleKey)}</strong>
      {bodyKey ? <p>{tt(bodyKey)}</p> : null}
      <p className="ob-muted">{message}</p>
      {error instanceof OnboardingClientError && error.correlationId ? (
        <p className="ob-muted">{tt("error.reference", { id: error.correlationId })}</p>
      ) : null}
      <div className="ob-actions">
        {code === "CONFLICT" && onReload ? (
          <Button type="button" variant="primary" onClick={onReload}>{tt("error.reloadLatest")}</Button>
        ) : null}
        {onDismiss ? <Button type="button" onClick={onDismiss}>{tt("error.dismiss")}</Button> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <div className={`ob-alert ob-alert--${tone}`} role="note">
      {tone === "warning" ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}
      <div>{children}</div>
    </div>
  );
}
