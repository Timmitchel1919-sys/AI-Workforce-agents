import React from "react";
import "./ui.css";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "primary" | "success" | "warning" | "danger" | "info";
}

export function Badge({ variant = "neutral", children, ...rest }: BadgeProps) {
  return (
    <span className={["ui-badge", variant].join(" ")} role="status" {...rest}>{children}</span>
  );
}

export default Badge;
