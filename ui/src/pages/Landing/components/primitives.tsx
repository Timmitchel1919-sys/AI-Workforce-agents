import type { CSSProperties, ReactNode } from "react";
import { useReveal } from "../hooks/useLandingMotion";
import type { AgentStatus, EnvironmentStatus } from "../landingContent";
import { useI18n } from "../../../i18n";

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const [ref, revealed] = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={["lp-reveal", revealed ? "is-revealed" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={delay ? ({ "--lp-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: string;
  id: string;
}) {
  return (
    <Reveal className="lp-section-heading">
      <p className="lp-eyebrow">{eyebrow}</p>
      <h2 id={id} className="lp-section-title">
        {title}
      </h2>
      {lead ? <p className="lp-section-lead">{lead}</p> : null}
    </Reveal>
  );
}

export function StatusPill({ status }: { status: EnvironmentStatus | AgentStatus }) {
  const { t } = useI18n();
  return (
    <span className={`lp-status lp-status--${status}`}>
      <span className="lp-status__dot" aria-hidden="true" />
      {t(`landing.statuses.${status}`)}
    </span>
  );
}

export function PresentationNote({ children }: { children: ReactNode }) {
  return <p className="lp-note">{children}</p>;
}
