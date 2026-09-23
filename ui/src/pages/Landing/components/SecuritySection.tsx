import { ClipboardCheck, Eye, Fingerprint, Layers, Lock, ShieldCheck, type LucideIcon } from "lucide-react";
import { useI18n } from "../../../i18n";
import { securityItems } from "../landingContent";
import { Reveal, SectionHeading } from "./primitives";

const icons: LucideIcon[] = [Fingerprint, Lock, Layers, ClipboardCheck, Eye, ShieldCheck];

export function SecuritySection() {
  const { t } = useI18n();
  return (
    <section id="security" className="lp-section" aria-labelledby="lp-security-title">
      <SectionHeading
        id="lp-security-title"
        eyebrow={t("landing.security.eyebrow")}
        title={t("landing.security.title")}
        lead={t("landing.security.lead")}
      />

      <ul className="lp-security-grid">
        {securityItems.map((item, index) => {
          const Icon = icons[index];
          return (
            <li key={item}>
              <Reveal className="lp-security-card lp-glass" delay={(index % 3) * 80}>
                <span className="lp-security-card__icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <h3 className="lp-security-card__title">{t(`landing.security.items.${item}.title`)}</h3>
                <p className="lp-security-card__body">{t(`landing.security.items.${item}.body`)}</p>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default SecuritySection;
