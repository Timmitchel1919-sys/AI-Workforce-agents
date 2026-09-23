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
import { useI18n } from "../../../i18n";
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
  const { t } = useI18n();
  return (
    <section id="capabilities" className="lp-section" aria-labelledby="lp-env-title">
      <SectionHeading
        id="lp-env-title"
        eyebrow={t("landing.env.eyebrow")}
        title={t("landing.env.title")}
        lead={t("landing.env.lead")}
      />

      <ul className="lp-env-grid">
        {environments.map((environment, index) => {
          const Icon = iconMap[environment.icon];
          return (
            <li key={environment.id}>
              <Reveal className="lp-env-card lp-glass" delay={(index % 4) * 70}>
                <div className="lp-env-card__top">
                  <span className="lp-env-card__icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <StatusPill status={environment.status} />
                </div>
                <h3 className="lp-env-card__name">
                  {environment.nameKey ? t(environment.nameKey) : environment.name}
                </h3>
                <p className="lp-env-card__description">{t(environment.descriptionKey)}</p>
              </Reveal>
            </li>
          );
        })}
      </ul>

      <PresentationNote>
        <strong>{t("landing.env.noteRegistered")}</strong> {t("landing.env.noteRegisteredText")}{" "}
        <strong>{t("landing.env.notePlanned")}</strong> {t("landing.env.notePlannedText")}
      </PresentationNote>
    </section>
  );
}

export default EnvironmentSection;
