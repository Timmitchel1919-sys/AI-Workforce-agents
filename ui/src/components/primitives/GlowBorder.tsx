import * as React from "react";
import "./primitives.css";

export interface GlowBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** When false, the conic animation freezes and dims to a static edge. */
  active?: boolean;
  radius?: number;
  children: React.ReactNode;
}

/**
 * Animated conic edge. Pauses automatically when offscreen (IntersectionObserver)
 * or when the tab is hidden, and respects prefers-reduced-motion via CSS. Only
 * the elements actually in view burn GPU cycles.
 */
export const GlowBorder = React.forwardRef<HTMLDivElement, GlowBorderProps>(
  ({ active = true, radius, children, className, style, ...rest }, ref) => {
    const localRef = React.useRef<HTMLDivElement | null>(null);
    const [visible, setVisible] = React.useState(true);

    React.useImperativeHandle(ref, () => localRef.current as HTMLDivElement);

    React.useEffect(() => {
      const el = localRef.current;
      if (!el || typeof IntersectionObserver === "undefined") return;
      const io = new IntersectionObserver(
        (entries) => entries.forEach((e) => setVisible(e.isIntersecting)),
        { rootMargin: "80px" },
      );
      io.observe(el);
      return () => io.disconnect();
    }, []);

    const mergedStyle: React.CSSProperties = {
      ...(radius !== undefined ? { borderRadius: radius } : null),
      ...style,
    };
    return (
      <div
        ref={localRef}
        className={["aw-glow", className].filter(Boolean).join(" ")}
        data-active={active && visible}
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
