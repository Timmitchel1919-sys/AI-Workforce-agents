import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import "./ui.css";

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  compact?: boolean;
  interactive?: boolean;
}

export function Card({ title, description, header, footer, compact, interactive, children, className, ...rest }: CardProps) {
  const reduce = useReducedMotion();
  const shouldHover = !reduce && (interactive ?? Boolean(rest.onClick));

  return (
    <motion.div
      className={["ui-card", compact ? "compact" : "", className ?? ""].filter(Boolean).join(" ")}
      whileHover={shouldHover ? { y: -3, scale: 1.01 } : undefined}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      {...(rest as React.ComponentProps<typeof motion.div>)}
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
    </motion.div>
  );
}

export default Card;
