import { pipelineSteps } from "../landingContent";
import { PresentationNote, Reveal, SectionHeading } from "./primitives";

export function OrchestrationPipeline() {
  return (
    <section id="architecture" className="lp-section" aria-labelledby="lp-pipeline-title">
      <SectionHeading
        id="lp-pipeline-title"
        eyebrow="Orchestration"
        title="From request to release, one governed pipeline"
        lead="Every project request moves through analysis, architecture, routing, and qualification before a single line is executed."
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
              <span className="lp-pipeline__label">{step}</span>
            </li>
          ))}
        </ol>
      </Reveal>

      <PresentationNote>Pipeline stages illustrate the orchestration design; they are not a live run.</PresentationNote>
    </section>
  );
}

export default OrchestrationPipeline;
