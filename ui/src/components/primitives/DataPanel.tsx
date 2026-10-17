import * as React from "react";
import { GlassPanel, type GlassPanelProps } from "./GlassPanel";

type Density = "default" | "compact";

export interface DataPanelProps extends GlassPanelProps {
  density?: Density;
}

/**
 * DataPanel is the standard surface for internal operational screens — dense
 * tables, logs, metrics, lists. It uses a lower blur than GlassCard so dense
 * text under it stays crisp.
 */
export const DataPanel = React.forwardRef<HTMLDivElement, DataPanelProps>(
  ({ density = "default", className, ...rest }, ref) => {
    return (
      <GlassPanel
        ref={ref}
        className={[
          "aw-data-panel",
          density === "compact" ? "aw-data-panel--compact" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      />
    );
  },
);
DataPanel.displayName = "DataPanel";
export default DataPanel;
