import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveEventsState } from "../hooks/useLiveEvents";
import { buildTerminalLines, formatDuration } from "../lib/logic";
import { useT } from "../lib/useT";
import type { CommandRecord } from "../types";
import { ErrorPanel, Notice } from "./common";

/** Read-only terminal: there is deliberately no input and no way to run a command from here. */
export function Terminal({ live, commands, statusLine }: { live: LiveEventsState; commands: readonly CommandRecord[]; statusLine: string }) {
  const { tt, label } = useT();
  const [paused, setPaused] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => buildTerminalLines(live.events, commands), [live.events, commands]);

  useEffect(() => {
    const el = logRef.current;
    if (!paused && el) el.scrollTop = el.scrollHeight;
  }, [lines, paused]);

  return (
    <section className="lw-panel lw-area-terminal" aria-labelledby="lw-terminal-heading">
      <div className="lw-terminal__bar">
        <h2 id="lw-terminal-heading" className="lw-panel__title">{tt("terminal.title")}</h2>
        <button type="button" className="ui-button secondary" aria-pressed={paused} onClick={() => setPaused(!paused)}>
          {paused ? tt("terminal.resumeScroll") : tt("terminal.pauseScroll")}
        </button>
      </div>
      <p className="lw-muted">{tt("terminal.readOnly")}</p>
      <p className="lw-visually-hidden" role="status" aria-live="polite" data-testid="status-line">{statusLine}</p>
      {live.reconnecting ? (
        <Notice tone="warning">{tt("terminal.reconnecting", { seq: live.reconnecting.fromSeq })}</Notice>
      ) : null}
      {live.fatal ? (
        <div className="lw-stack">
          <ErrorPanel error={live.fatal} onRetry={live.restart} />
        </div>
      ) : null}
      <div ref={logRef} role="log" aria-live="off" aria-label={tt("terminal.label")} tabIndex={0} className="lw-terminal">
        {lines.length === 0 ? <div className="lw-term lw-term--info">{tt("terminal.empty")}</div> : null}
        {lines.map((line) => {
          switch (line.kind) {
            case "cmd": return <div key={line.key} className="lw-term lw-term--cmd">{`$ ${line.text}`}</div>;
            case "out": return <div key={line.key} className="lw-term lw-term--out">{line.text}</div>;
            case "exit": {
              const dur = formatDuration(line.durationMs);
              return (
                <div key={line.key} className="lw-term lw-term--exit">
                  {tt("terminal.exit", { code: line.exitCode === null ? tt("terminal.noExit") : line.exitCode })}
                  {dur ? ` · ${dur}` : ""}
                </div>
              );
            }
            case "marker":
              return <div key={line.key} className="lw-term lw-term--marker">[{tt(`terminal.marker.${line.marker}`)}]{line.text ? ` ${line.text}` : ""}</div>;
            default:
              return (
                <div key={line.key} className="lw-term lw-term--info">
                  {`· ${label("eventType", line.type)}`}{line.text ? `: ${line.text}` : ""}
                </div>
              );
          }
        })}
      </div>
      {live.done ? <p className="lw-muted">{tt("terminal.ended")}</p> : <p className="lw-muted">{tt("terminal.live")}</p>}
    </section>
  );
}
