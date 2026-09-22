import React from "react";
import "./ui.css";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "small" | "medium" | "large";
  loading?: boolean;
}

export function IconButton({ label, size = "medium", loading, children, className, ...rest }: IconButtonProps) {
  const classNames = ["ui-icon-button", size, className].filter(Boolean).join(" ");

  return (
    <button className={classNames} aria-label={label} title={label} {...rest} disabled={rest.disabled || loading}>
      {loading ? <span className="ui-spinner" aria-hidden>●</span> : children}
    </button>
  );
}

export default IconButton;
