import type { CSSProperties } from "react";
import type { GraphOperationalState } from "../../../../../contracts/graph";
import { useI18n } from "../../../i18n";
import { stateCssVar, stateStyle } from "../lib/stateStyle";
import { stateLabel } from "../lib/labels";

/** State shown as glyph + colour + text, so colour is never the only signal. */
export function StateBadge({ state }: { state: GraphOperationalState }) {
  const { t } = useI18n();
  const style = { "--sg-state-color": stateCssVar(state) } as CSSProperties;
  return (
    <span className={`sg-state sg-state--${state}`} style={style}>
      <span className="sg-state__glyph" aria-hidden="true">
        {stateStyle(state).glyph}
      </span>
      <span className="sg-state__text">{stateLabel(t, state)}</span>
    </span>
  );
}
