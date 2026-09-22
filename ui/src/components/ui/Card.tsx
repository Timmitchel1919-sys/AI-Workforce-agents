import React from "react";
import "./ui.css";

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  compact?: boolean;
}

export function Card({ title, description, header, footer, compact, children, className, ...rest }: CardProps) {
  return (
    <div
      className={["ui-card", compact ? "compact" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {(title || header) && (
        <div className="header">
          <div>
            {title ? <div style={{ fontWeight: 700 }}>{title}</div> : null}
            {description ? <div className="desc">{description}</div> : null}
          </div>
          {header}
        </div>
      )}
      <div>{children}</div>
      {footer ? <div className="footer">{footer}</div> : null}
    </div>
  );
}

export default Card;
