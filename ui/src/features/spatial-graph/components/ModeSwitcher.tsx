import { useRef, type KeyboardEvent } from "react";
import type { GraphMode } from "../../../../../contracts/graph";
import { useI18n } from "../../../i18n";
import { MODE_LIST, stepMode } from "../lib/modes";

interface Props {
  mode: GraphMode;
  busy: boolean;
  onChange: (mode: GraphMode) => void;
}

/** Radio group with roving tabindex; arrow keys move and select (wrapping). */
export function ModeSwitcher({ mode, busy, onChange }: Props) {
  const { t } = useI18n();
  const refs = useRef(new Map<GraphMode, HTMLButtonElement>());

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: GraphMode | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = stepMode(mode, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = stepMode(mode, -1);
    else if (e.key === "Home") next = MODE_LIST[0];
    else if (e.key === "End") next = MODE_LIST[MODE_LIST.length - 1];
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(next);
    refs.current.get(next)?.focus();
  };

  return (
    <div className="sg-modes" role="radiogroup" aria-label={t("spatial.modeLabel")} aria-busy={busy} onKeyDown={onKeyDown}>
      {MODE_LIST.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={m === mode}
          tabIndex={m === mode ? 0 : -1}
          className="sg-chip sg-mode"
          ref={(el) => {
            if (el) refs.current.set(m, el);
            else refs.current.delete(m);
          }}
          onClick={() => onChange(m)}
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
