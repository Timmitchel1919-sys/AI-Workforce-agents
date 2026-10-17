import * as React from "react";
import "./primitives.css";

export interface GlowBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** When false, the conic animation freezes and dims to a static edge. */
  active?: boolean;
  radius?: number;
  children: React.ReactNode;
}

export const GlowBorder = React.forwardRef<HTMLDivElement, GlowBorderProps>(
  ({ active = true, radius, children, className, style, ...rest }, ref) => {
    const mergedStyle: React.CSSProperties = {
      ...(radius !== undefined ? { borderRadius: radius } : null),
      ...style,
    };
    return (
      <div
        ref={ref}
        className={["aw-glow", className].filter(Boolean).join(" ")}
        data-active={active}
        style={mergedStyle}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
GlowBorder.displayName = "GlowBorder";
export default GlowBorder;
