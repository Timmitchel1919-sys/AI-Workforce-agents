import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  /** Apply body padding directly on the card (for simple content). */
  padded?: boolean;
}

export function Card({
  elevated,
  padded,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "ui-card",
        elevated && "ui-card--elevated",
        padded && "ui-card--pad",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ui-card__header">
      <span>{children}</span>
      {actions ? <span className="ui-inline">{actions}</span> : null}
    </div>
  );
}

export function CardBody({ children }: { children: ReactNode }) {
  return <div className="ui-card__body">{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="ui-card__footer">{children}</div>;
}

export function Divider({
  vertical = false,
  className,
}: {
  vertical?: boolean;
  className?: string;
}) {
  return (
    <hr
      className={cn(
        "ui-divider",
        vertical && "ui-divider--vertical",
        className,
      )}
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
    />
  );
}
