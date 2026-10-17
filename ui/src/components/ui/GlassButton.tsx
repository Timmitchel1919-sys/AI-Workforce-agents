import * as React from "react";
import "./GlassButton.css";

type Size = "sm" | "default" | "lg" | "icon";

export interface GlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  contentClassName?: string;
}

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, children, size = "default", contentClassName, ...rest }, ref) => {
    return (
      <div className={["ui-glass-btn-wrap", className].filter(Boolean).join(" ")}>
        <button
          ref={ref}
          className={["ui-glass-btn", size].join(" ")}
          {...rest}
        >
          <span
            className={["ui-glass-btn-text", contentClassName]
              .filter(Boolean)
              .join(" ")}
          >
            {children}
          </span>
        </button>
        <div className="ui-glass-btn-shadow" />
      </div>
    );
  },
);
GlassButton.displayName = "GlassButton";

export default GlassButton;
