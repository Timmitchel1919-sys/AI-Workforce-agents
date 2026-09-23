import { useI18n } from "../../../i18n";
import { pipelineSteps } from "../landingContent";
import { PresentationNote, Reveal, SectionHeading } from "./primitives";

export function OrchestrationPipeline() {
  const { t } = useI18n();
  return (
    <section id="architecture" className="lp-section" aria-labelledby="lp-pipeline-title">
      <SectionHeading
        id="lp-pipeline-title"
        eyebrow={t("landing.pipeline.eyebrow")}
        title={t("landing.pipeline.title")}
        lead={t("landing.pipeline.lead")}
      />

      <Reveal className="lp-pipeline-frame lp-glass">
        <ol className="lp-pipeline">
          {pipelineSteps.map((step, index) => (
            <li
              key={step}
              className={[
                "lp-pipeline__step",
                index === 0 ? "lp-pipeline__step--start" : "",
                index === pipelineSteps.length - 1 ? "lp-pipeline__step--end" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="lp-pipeline__index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="lp-pipeline__label">{t(step)}</span>
            </li>
          ))}
        </ol>
      </Reveal>

      <PresentationNote>{t("landing.pipeline.note")}</PresentationNote>
    </section>
  );
}

export default OrchestrationPipeline;
