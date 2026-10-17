import * as React from "react";
import { GlassPanel, type GlassPanelProps } from "./GlassPanel";

type Pad = "sm" | "md" | "lg";

export interface GlassCardProps extends GlassPanelProps {
  pad?: Pad;
}

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ pad = "md", className, ...rest }, ref) => {
    const padCls = pad === "sm" ? "pad-sm" : pad === "lg" ? "pad-lg" : "";
    return (
      <GlassPanel
        ref={ref}
        className={["aw-card", padCls, className].filter(Boolean).join(" ")}
        {...rest}
      />
    );
  },
);
GlassCard.displayName = "GlassCard";
export default GlassCard;
