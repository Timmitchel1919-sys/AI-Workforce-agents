import React from "react";
import { motion, useReducedMotion } from "framer-motion";
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
  const reduce = useReducedMotion();
  const classNames = ["ui-button", variant, size === "small" ? "small" : size === "large" ? "large" : "", fullWidth ? "fullWidth" : ""].join(" ");

  const hover = reduce ? undefined : { scale: 1.02, y: -1 };
  const tap = reduce ? undefined : { scale: 0.98 };

  return (
    <motion.button
      className={classNames}
      aria-busy={loading}
      {...(rest as React.ComponentProps<typeof motion.button>)}
      disabled={rest.disabled || loading}
      whileHover={hover}
      whileTap={tap}
      transition={{ type: "spring", stiffness: 400, damping: 24 }}
    >
      {loading ? <span className="ui-spinner" aria-hidden>●</span> : null}
      <span style={{ marginLeft: loading ? 8 : 0 }}>{children}</span>
    </motion.button>
  );
}

export default Button;
