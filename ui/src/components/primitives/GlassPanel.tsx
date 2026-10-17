import * as React from "react";
import "./primitives.css";

type Elevation = "default" | "elevated" | "flat";

export interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: Elevation;
}

export const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ elevation = "default", className, ...rest }, ref) => {
    const cls = [
      "aw-panel",
      elevation === "elevated" ? "aw-panel--elevated" : "",
      elevation === "flat" ? "aw-panel--flat" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    return <div ref={ref} className={cls} {...rest} />;
  },
);
GlassPanel.displayName = "GlassPanel";
export default GlassPanel;
