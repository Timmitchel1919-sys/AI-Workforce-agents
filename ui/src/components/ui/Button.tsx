import React from "react";
import "./ui.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "default" | "small" | "large";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({ variant = "secondary", size = "default", loading, fullWidth, children, ...rest }: ButtonProps) {
  const classNames = ["ui-button", variant, size === "small" ? "small" : size === "large" ? "large" : "", fullWidth ? "fullWidth" : ""].join(" ");

  return (
    <button className={classNames} aria-busy={loading} {...rest} disabled={rest.disabled || loading}>
      {loading ? <span className="ui-spinner" aria-hidden>●</span> : null}
      <span style={{ marginLeft: loading ? 8 : 0 }}>{children}</span>
    </button>
  );
}

export default Button;
