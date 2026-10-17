import * as React from "react";
import "./GlassButton.css";

type Size = "sm" | "default" | "lg" | "icon" | "compact";
type Variant = "primary" | "secondary" | "ghost" | "premium" | "danger" | "success" | "toolbar";

export interface GlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  variant?: Variant;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  contentClassName?: string;
}

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  (
    {
      className,
      children,
      size = "default",
      variant = "secondary",
      loading = false,
      disabled,
      leftIcon,
      rightIcon,
      contentClassName,
      "aria-busy": ariaBusy,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    return (
      <div
        className={["ui-glass-btn-wrap", `v-${variant}`, className]
          .filter(Boolean)
          .join(" ")}
        data-disabled={isDisabled ? "true" : undefined}
      >
        <button
          ref={ref}
          type={rest.type ?? "button"}
          className={["ui-glass-btn", size, `v-${variant}`].join(" ")}
          disabled={isDisabled}
          aria-busy={loading || ariaBusy}
          {...rest}
        >
          <span
            className={["ui-glass-btn-text", contentClassName]
              .filter(Boolean)
              .join(" ")}
          >
            {loading && <span className="ui-glass-btn-spinner" aria-hidden />}
            {!loading && leftIcon && (
              <span className="ui-glass-btn-ico" aria-hidden>{leftIcon}</span>
            )}
            <span className="ui-glass-btn-label">{children}</span>
            {!loading && rightIcon && (
              <span className="ui-glass-btn-ico" aria-hidden>{rightIcon}</span>
            )}
          </span>
        </button>
        <div className="ui-glass-btn-shadow" />
      </div>
    );
  },
);
GlassButton.displayName = "GlassButton";

export default GlassButton;
