import {
  Box,
  Cloud,
  CodeXml,
  Container,
  Gamepad2,
  Hammer,
  Monitor,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { environments, type EnvironmentIconId } from "../landingContent";
import { PresentationNote, Reveal, SectionHeading, StatusPill } from "./primitives";

const iconMap: Record<EnvironmentIconId, LucideIcon> = {
  code: CodeXml,
  monitor: Monitor,
  hammer: Hammer,
  smartphone: Smartphone,
  container: Container,
  cloud: Cloud,
  box: Box,
  gamepad: Gamepad2,
};

export function EnvironmentSection() {
  return (
    <section id="capabilities" className="lp-section" aria-labelledby="lp-env-title">
      <SectionHeading
        id="lp-env-title"
        eyebrow="Multi-Environment"
        title="Build without environment limits"
        lead="The Environment Router matches each task to a detected, capable host. Support is declared per environment type; availability only ever comes from live detection."
      />

      <ul className="lp-env-grid">
        {environments.map((environment, index) => {
          const Icon = iconMap[environment.icon];
          return (
            <li key={environment.name}>
              <Reveal className="lp-env-card lp-glass" delay={(index % 4) * 70}>
                <div className="lp-env-card__top">
                  <span className="lp-env-card__icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <StatusPill status={environment.status} />
                </div>
                <h3 className="lp-env-card__name">{environment.name}</h3>
                <p className="lp-env-card__description">{environment.description}</p>
              </Reveal>
            </li>
          );
        })}
      </ul>

      <PresentationNote>
        <strong>Registered</strong> — a support descriptor exists in the production catalog.{" "}
        <strong>Planned</strong> — detection probe not yet shipped. No environment is shown as
        available until a real host reports it.
      </PresentationNote>
    </section>
  );
}

export default EnvironmentSection;
