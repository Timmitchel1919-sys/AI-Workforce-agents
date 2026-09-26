import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { GraphMode } from "../../../../../contracts/graph";
import { useI18n } from "../../../i18n";
import { MODE_LIST, stepMode } from "../lib/modes";

interface Props {
  /** The committed mode. */
  mode: GraphMode;
  busy: boolean;
  onChange: (mode: GraphMode) => void;
}

/**
 * Toolbar of toggle buttons. Arrow/Home/End only MOVE focus (roving tabindex); Enter, Space
 * or a click COMMIT, and a commit calls `onChange` exactly once (no fetch per arrow key).
 */
export function ModeSwitcher({ mode, busy, onChange }: Props) {
  const { t } = useI18n();
  const refs = useRef(new Map<GraphMode, HTMLButtonElement>());
  const [cursor, setCursor] = useState<GraphMode | null>(null);
  const tabStop = cursor ?? mode;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: GraphMode | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = stepMode(tabStop, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = stepMode(tabStop, -1);
    else if (e.key === "Home") next = MODE_LIST[0];
    else if (e.key === "End") next = MODE_LIST[MODE_LIST.length - 1];
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    setCursor(next);
    refs.current.get(next)?.focus();
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setCursor(null);
  };

  const commit = (m: GraphMode) => {
    if (m !== mode) onChange(m);
  };

  return (
    <div
      className="sg-modes"
      role="toolbar"
      aria-label={t("spatial.modeLabel")}
      aria-busy={busy}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {MODE_LIST.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={m === mode}
          tabIndex={m === tabStop ? 0 : -1}
          className="sg-chip sg-mode"
          ref={(el) => {
            if (el) refs.current.set(m, el);
            else refs.current.delete(m);
          }}
          onFocus={() => setCursor(m)}
          onClick={() => commit(m)}
        >
          {t(`spatial.modes.${m}` as never)}
        </button>
      ))}
      {busy && (
        <span className="sg-busy" role="status">
          {t("spatial.loadingMode")}
        </span>
      )}
    </div>
  );
}
