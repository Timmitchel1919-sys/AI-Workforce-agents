import * as React from "react";
import { GlassPanel } from "./GlassPanel";
import { GlowBorder } from "./GlowBorder";
import "./primitives.css";

export type CommandItem = {
  id: string;
  label: string;
  meta?: string;
  state?: "active" | "queued" | "running" | "idle";
};

export type CommandColumn = {
  heading: string;
  trailing?: React.ReactNode;
  items: CommandItem[];
  /** The primary column stays visible on mobile; the others collapse into a chip summary. */
  primary?: boolean;
};

export type CommandChip = {
  label: string;
  tone?: "ok" | "warn" | "cyan" | "violet";
};

export type CommandSummary = {
  label: string;
  value: string;
};

export interface CommandPanelProps {
  columns: [CommandColumn, CommandColumn, CommandColumn];
  footerChips?: CommandChip[];
  /** Compact chip row shown instead of the collapsed columns on mobile. */
  mobileSummary?: CommandSummary[];
  active?: boolean;
  /** Force all columns visible on mobile (used by dedicated preview routes, not the hero). */
  mobileFull?: boolean;
}

function pulseClass(state?: CommandItem["state"]) {
  if (state === "running" || state === "active") return "aw-cmd-pulse";
  if (state === "queued") return "aw-cmd-pulse aw-cmd-pulse--violet";
  return "aw-cmd-pulse aw-cmd-pulse--idle";
}

export function CommandPanel({
  columns,
  footerChips,
  mobileSummary,
  mobileFull = false,
  active = true,
}: CommandPanelProps) {
  return (
    <GlowBorder active={active} radius={22}>
      <GlassPanel
        elevation="elevated"
        className="aw-cmd"
        aria-label="AI Workforce command preview"
        data-mobile-mode={mobileFull ? "full" : "primary"}
      >
        {columns.map((col) => (
          <section
            key={col.heading}
            className={["aw-cmd-col", col.primary ? "aw-cmd-col--primary" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="aw-cmd-col-head">
              <span>{col.heading}</span>
              {col.trailing}
            </div>
            {col.items.map((item) => (
              <div
                key={item.id}
                className={[
                  "aw-cmd-item",
                  item.state === "active" ? "aw-cmd-item--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="aw-cmd-row">
                  <span className={pulseClass(item.state)} aria-hidden />
                  <span className="aw-cmd-item-label">{item.label}</span>
                </div>
                {item.meta && <span className="aw-cmd-item-meta">{item.meta}</span>}
              </div>
            ))}
          </section>
        ))}

        {mobileSummary && mobileSummary.length > 0 && !mobileFull && (
          <div className="aw-cmd-mobile-summary" aria-label="Summary">
            {mobileSummary.map((s) => (
              <span key={s.label}>
                {s.label} · <b>{s.value}</b>
              </span>
            ))}
          </div>
        )}

        {footerChips && footerChips.length > 0 && (
          <div
            className="aw-cmd-row"
            style={{ gridColumn: "1 / -1", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" }}
          >
            {footerChips.map((c) => (
              <span key={c.label} className={["aw-cmd-chip", c.tone ?? ""].join(" ")}>
                {c.label}
              </span>
            ))}
          </div>
        )}
      </GlassPanel>
    </GlowBorder>
  );
}
export default CommandPanel;
