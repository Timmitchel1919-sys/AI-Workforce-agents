import type { ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CircleCheck,
  Inbox,
  Info,
  Loader2,
  ShieldAlert,
  type LucideIcon,
} from "./icons";
import { cn } from "../../lib/utils";

/* ---- Spinner ------------------------------------------------------- */
export function Spinner({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("ui-spinner", className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="ui-spinner__icon" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

/* ---- Skeleton ---------------------------------------------------- */
export function Skeleton({
  variant = "block",
  width,
  height,
  count = 1,
  className,
}: {
  variant?: "block" | "text" | "circle";
  width?: string | number;
  height?: string | number;
  count?: number;
  className?: string;
}) {
  const style = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
  };
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn("ui-skeleton", `ui-skeleton--${variant}`, className)}
          style={style}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/* ---- LoadingOverlay ------------------------------------------- */
export function LoadingOverlay({ label = "Loading" }: { label?: string }) {
  return (
    <div className="ui-loading-overlay">
      <Spinner label={label} />
    </div>
  );
}

/* ---- Alert -------------------------------------------------- */
export type AlertTone = "neutral" | "info" | "success" | "warning" | "danger";
const ALERT_ICON: Record<AlertTone, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export function Alert({
  tone = "neutral",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = ALERT_ICON[tone];
  return (
    <div
      className={cn("ui-alert", `ui-alert--${tone}`, className)}
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
    >
      <Icon className="ui-alert__icon" aria-hidden="true" />
      <div>
        {title ? <div className="ui-alert__title">{title}</div> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

/* ---- EmptyState / ErrorState ---------------------------------- */
export function EmptyState({
  title,
  detail,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  detail?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="ui-state" role="status">
      <Icon className="ui-state__icon" aria-hidden="true" />
      <p className="ui-state__title">{title}</p>
      {detail ? <p className="ui-state__detail">{detail}</p> : null}
      {action ? <div className="ui-state__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  detail,
  variant = "error",
  action,
}: {
  title?: string;
  detail?: string;
  variant?: "error" | "forbidden" | "not-found" | "network";
  action?: ReactNode;
}) {
  const Icon =
    variant === "forbidden"
      ? ShieldAlert
      : variant === "not-found"
        ? Inbox
        : AlertTriangle;
  return (
    <div
      className={cn(
        "ui-state",
        variant === "forbidden" ? "ui-state--forbidden" : "ui-state--error",
      )}
      role="alert"
    >
      <Icon className="ui-state__icon" aria-hidden="true" />
      <p className="ui-state__title">{title}</p>
      {detail ? <p className="ui-state__detail">{detail}</p> : null}
      {action ? <div className="ui-state__action">{action}</div> : null}
    </div>
  );
}
