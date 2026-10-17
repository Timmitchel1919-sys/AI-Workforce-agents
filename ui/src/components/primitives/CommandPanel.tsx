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
};

export type CommandChip = {
  label: string;
  tone?: "ok" | "warn" | "cyan" | "violet";
};

export interface CommandPanelProps {
  columns: [CommandColumn, CommandColumn, CommandColumn];
  footerChips?: CommandChip[];
  active?: boolean;
}

function pulseClass(state?: CommandItem["state"]) {
  if (state === "running" || state === "active") return "aw-cmd-pulse";
  if (state === "queued") return "aw-cmd-pulse aw-cmd-pulse--violet";
  return "aw-cmd-pulse aw-cmd-pulse--idle";
}

export function CommandPanel({ columns, footerChips, active = true }: CommandPanelProps) {
  return (
    <GlowBorder active={active} radius={22}>
      <GlassPanel elevation="elevated" className="aw-cmd" aria-label="AI Workforce command preview">
        {columns.map((col) => (
          <section key={col.heading} className="aw-cmd-col">
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
        {footerChips && footerChips.length > 0 && (
          <footer
            className="aw-cmd-row"
            style={{ gridColumn: "1 / -1", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" }}
          >
            {footerChips.map((c) => (
              <span key={c.label} className={["aw-cmd-chip", c.tone ?? ""].join(" ")}>
                {c.label}
              </span>
            ))}
          </footer>
        )}
      </GlassPanel>
    </GlowBorder>
  );
}
export default CommandPanel;
