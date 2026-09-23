import { agentDepartments } from "../landingContent";
import { PresentationNote, Reveal, SectionHeading, StatusPill } from "./primitives";

export function AgentWorkforceSection() {
  return (
    <section className="lp-section" aria-labelledby="lp-agents-title">
      <SectionHeading
        id="lp-agents-title"
        eyebrow="Agent Workforce"
        title={
          <>
            Specialized intelligence.
            <br />
            One coordinated workforce.
          </>
        }
        lead="Each agent is a declared system node with a role, a capability boundary, and explicit permissions — orchestrated, never improvised."
      />

      <ul className="lp-agent-grid">
        {agentDepartments.map((agent, index) => (
          <li key={agent.name}>
            <Reveal
              className={`lp-agent-card lp-glass lp-agent-card--${agent.status}`}
              delay={(index % 5) * 60}
            >
              <div className="lp-agent-card__top">
                <span className="lp-agent-card__code" aria-hidden="true">
                  {agent.code}
                </span>
                <StatusPill status={agent.status} />
              </div>
              <h3 className="lp-agent-card__name">{agent.name}</h3>
              <p className="lp-agent-card__role">{agent.role}</p>
              <p className="lp-agent-card__capability">{agent.capability}</p>
            </Reveal>
          </li>
        ))}
      </ul>

      <PresentationNote>
        <strong>Registered</strong> — bound in the production workforce.{" "}
        <strong>Implemented</strong> — agent exists in the codebase, not yet enabled in production.{" "}
        <strong>Planned</strong> — on the roadmap.
      </PresentationNote>
    </section>
  );
}

export default AgentWorkforceSection;
