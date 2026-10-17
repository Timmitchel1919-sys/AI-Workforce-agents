import * as React from "react";
import { GlassCard } from "./GlassCard";
import { GlowBorder } from "./GlowBorder";
import "./primitives.css";

export interface AuthCardProps extends React.HTMLAttributes<HTMLDivElement> {
  mode?: "signin" | "forgot" | "signup";
  title: string;
  subtitle?: string;
  notice?: React.ReactNode;
  footer?: React.ReactNode;
  /** Dim the glow border, e.g. during loading, success, or form error states. */
  active?: boolean;
  children: React.ReactNode;
}

export function AuthCard({
  mode = "signin",
  title,
  subtitle,
  notice,
  footer,
  active = true,
  children,
  className,
  ...rest
}: AuthCardProps) {
  return (
    <GlowBorder active={active} radius={22} className={className}>
      <GlassCard
        pad="lg"
        elevation="elevated"
        className="aw-auth"
        data-mode={mode}
        {...rest}
      >
        <header className="aw-auth-header">
          <span className="aw-auth-logo">
            <span className="aw-auth-logo-dot" aria-hidden />
            AI Workforce OS
          </span>
          <h1 className="aw-auth-title">{title}</h1>
          {subtitle && <p className="aw-auth-subtitle">{subtitle}</p>}
          {notice && <p className="aw-auth-notice">{notice}</p>}
        </header>
        {children}
        {footer && <div className="aw-auth-footer">{footer}</div>}
      </GlassCard>
    </GlowBorder>
  );
}
export default AuthCard;
