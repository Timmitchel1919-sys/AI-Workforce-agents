import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { AgentStatus, EnvironmentStatus } from "../landingContent";
import { useI18n } from "../../../i18n";

const REVEAL_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const STAGGER_PARENT: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const classes = ["lp-reveal", "is-revealed", className ?? ""].filter(Boolean).join(" ");
  return (
    <motion.div
      className={classes}
      initial={reduce ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "0px 0px -10% 0px", amount: 0.12 }}
      variants={REVEAL_VARIANTS}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: delay / 1000 }}
      style={delay ? ({ "--lp-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </motion.div>
  );
}

export function RevealStagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "0px 0px -10% 0px", amount: 0.12 }}
      variants={STAGGER_PARENT}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={REVEAL_VARIANTS}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
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
