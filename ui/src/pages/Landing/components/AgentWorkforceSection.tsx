import { useI18n } from "../../../i18n";
import { agentDepartments } from "../landingContent";
import { PresentationNote, Reveal, SectionHeading, StatusPill } from "./primitives";

export function AgentWorkforceSection() {
  const { t } = useI18n();
  return (
    <section className="lp-section" aria-labelledby="lp-agents-title">
      <SectionHeading
        id="lp-agents-title"
        eyebrow={t("landing.agents.eyebrow")}
        title={
          <>
            {t("landing.agents.title1")}
            <br />
            {t("landing.agents.title2")}
          </>
        }
        lead={t("landing.agents.lead")}
      />

      <ul className="lp-agent-grid">
        {agentDepartments.map((agent, index) => (
          <li key={agent.id}>
            <Reveal
              className={`lp-agent-card lp-glass lp-agent-card--${agent.status}`}
              delay={(index % 5) * 60}
            >
              <div className="lp-agent-card__top">
                <span className="lp-agent-card__code" aria-hidden="true">
                  {agent.id.toUpperCase()}
                </span>
                <StatusPill status={agent.status} />
              </div>
              <h3 className="lp-agent-card__name">{t(`landing.agents.items.${agent.id}.name`)}</h3>
              <p className="lp-agent-card__role">{t(`landing.agents.items.${agent.id}.role`)}</p>
              <p className="lp-agent-card__capability">{t(`landing.agents.items.${agent.id}.capability`)}</p>
            </Reveal>
          </li>
        ))}
      </ul>

      <PresentationNote>
        <strong>{t("landing.agents.noteRegistered")}</strong> {t("landing.agents.noteRegisteredText")}{" "}
        <strong>{t("landing.agents.noteImplemented")}</strong> {t("landing.agents.noteImplementedText")}{" "}
        <strong>{t("landing.agents.notePlanned")}</strong> {t("landing.agents.notePlannedText")}
      </PresentationNote>
    </section>
  );
}

export default AgentWorkforceSection;
