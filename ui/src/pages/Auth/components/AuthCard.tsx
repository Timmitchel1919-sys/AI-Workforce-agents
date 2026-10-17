import type { ReactNode } from "react";
import { GlassCard } from "../../../components/primitives/GlassCard";
import { GlowBorder } from "../../../components/primitives/GlowBorder";

interface AuthCardProps {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Dim the glow border while the "access granted" transition plays. */
  granted?: boolean;
}

/**
 * Auth card shell. Shares the landing's primitives (GlassCard + GlowBorder)
 * so /login visually continues the operating-system vocabulary.
 */
export function AuthCard({ eyebrow, title, description, children, footer, granted = false }: AuthCardProps) {
  return (
    <GlowBorder active={!granted} radius={22}>
      <GlassCard
        pad="lg"
        elevation="elevated"
        className={`auth-card${granted ? " is-granted" : ""}`}
        aria-labelledby="auth-card-title"
        role="region"
      >
        <header className="auth-card__header">
          <p className="auth-card__eyebrow">{eyebrow}</p>
          <h1 id="auth-card-title" className="auth-card__title">
            {title}
          </h1>
          {description ? <p className="auth-card__description">{description}</p> : null}
        </header>

        <div className="auth-card__body">{children}</div>

        {footer ? <div className="auth-card__footer">{footer}</div> : null}
      </GlassCard>
    </GlowBorder>
  );
}

export default AuthCard;
