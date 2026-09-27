import { useT } from "../lib/useT";
import type { WizardStep } from "../lib/steps";

interface Props {
  steps: readonly WizardStep[];
  current: WizardStep;
  reachable: (step: WizardStep) => boolean;
  onSelect: (step: WizardStep) => void;
}

/** Keyboard-usable step list; the current step carries aria-current="step". */
export function Stepper({ steps, current, reachable, onSelect }: Props) {
  const { tt } = useT();
  const index = Math.max(0, steps.indexOf(current));
  return (
    <nav aria-label={tt("wizard.stepsLabel")} className="ob-stepper">
      <p className="ob-stepper__summary">{tt("wizard.stepOf", { current: index + 1, total: steps.length })}</p>
      <ol className="ob-stepper__list">
        {steps.map((s, i) => {
          const isCurrent = s === current;
          const enabled = current === "progress" ? isCurrent : reachable(s);
          return (
            <li key={s} className={`ob-stepper__item${isCurrent ? " is-current" : ""}${i < index ? " is-past" : ""}`}>
              <button
                type="button"
                className="ob-stepper__button"
                aria-current={isCurrent ? "step" : undefined}
                disabled={!enabled}
                onClick={() => onSelect(s)}
              >
                <span className="ob-stepper__num" aria-hidden>{i < index ? "✓" : i + 1}</span>
                <span>{tt(`step.${s}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
