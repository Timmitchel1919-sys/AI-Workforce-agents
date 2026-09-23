import type { ReactNode } from "react";
import { Lock } from "lucide-react";

interface AuthCardProps {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Plays the "access granted" edge trace. */
  granted?: boolean;
}

function isEncryptedConnection(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

export function AuthCard({ eyebrow, title, description, children, footer, granted = false }: AuthCardProps) {
  const encrypted = isEncryptedConnection();

  return (
    <section
      className={`auth-card lp-glass${granted ? " is-granted" : ""}`}
      aria-labelledby="auth-card-title"
    >
      <span className="auth-card__corner auth-card__corner--tl" aria-hidden="true" />
      <span className="auth-card__corner auth-card__corner--tr" aria-hidden="true" />
      <span className="auth-card__corner auth-card__corner--bl" aria-hidden="true" />
      <span className="auth-card__corner auth-card__corner--br" aria-hidden="true" />

      <svg className="auth-card__trace" aria-hidden="true" preserveAspectRatio="none">
        {/* Geometry comes from CSS so the trace follows the card size. */}
        <rect pathLength={100} />
      </svg>

      <div className="auth-card__edge">
        <span>Authentication node</span>
        {encrypted ? (
          <span className="auth-card__edge-status">
            <span className="auth-card__dot" aria-hidden="true" />
            Encrypted connection
          </span>
        ) : null}
      </div>

      <header className="auth-card__header">
        <p className="auth-card__eyebrow">{eyebrow}</p>
        <h1 id="auth-card-title" className="auth-card__title">
          {title}
        </h1>
        {description ? <p className="auth-card__description">{description}</p> : null}
      </header>

      <div className="auth-card__body">{children}</div>

      {footer ? <div className="auth-card__footer">{footer}</div> : null}

      <p className="auth-card__protected">
        <Lock size={12} aria-hidden="true" />
        Protected access · credentials are handled by Firebase Authentication
      </p>
    </section>
  );
}

export default AuthCard;
