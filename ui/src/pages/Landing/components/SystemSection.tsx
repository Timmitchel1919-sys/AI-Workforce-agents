import { controlPlaneBranches, coreModules } from "../landingContent";
import { PresentationNote, Reveal, SectionHeading } from "./primitives";

function ControlPlaneTree() {
  return (
    <div className="lp-tree" role="img" aria-label="The Control Plane coordinates Architect, Develop and Test agents, which hand off to Security, Deploy and Audit.">
      <div className="lp-tree__root lp-glass">
        <span className="lp-tree__root-dot" aria-hidden="true" />
        Control Plane
      </div>
      <div className="lp-tree__trunk" aria-hidden="true" />
      <div className="lp-tree__branches">
        {controlPlaneBranches.map((branch) => (
          <div key={branch.top} className="lp-tree__branch">
            <div className="lp-tree__node lp-glass">{branch.top}</div>
            <div className="lp-tree__link" aria-hidden="true" />
            <div className="lp-tree__node lp-tree__node--secondary lp-glass">{branch.bottom}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SystemCore() {
  return (
    <div className="lp-system-core">
      <ul className="lp-system-core__modules" aria-label="Architecture modules around the AI Workforce core">
        {coreModules.map((module, index) => (
          <li
            key={module}
            className="lp-system-core__module lp-glass"
            style={{ ["--i" as string]: index }}
          >
            {module}
          </li>
        ))}
      </ul>
      <div className="lp-system-core__center" aria-hidden="true">
        <div className="lp-system-core__halo" />
        <div className="lp-system-core__disc lp-glass">
          <span>AI</span>
          <span>Workforce</span>
        </div>
      </div>
    </div>
  );
}

export function SystemSection() {
  return (
    <section id="system" className="lp-section" aria-labelledby="lp-system-title">
      <SectionHeading
        id="lp-system-title"
        eyebrow="The System"
        title={
          <>
            One operating system.
            <br />
            An entire digital workforce.
          </>
        }
        lead="A single Control Plane coordinates specialised AI agents, routes every task to the right capability, and keeps humans in charge of what matters."
      />

      <div className="lp-system-grid">
        <Reveal className="lp-panel lp-glass">
          <h3 className="lp-panel__title">Coordinated by one Control Plane</h3>
          <ControlPlaneTree />
        </Reveal>
        <Reveal className="lp-panel lp-glass" delay={120}>
          <h3 className="lp-panel__title">The system core</h3>
          <SystemCore />
        </Reveal>
      </div>

      <PresentationNote>Architecture overview — an illustration of the product design, not live telemetry.</PresentationNote>
    </section>
  );
}

export default SystemSection;
