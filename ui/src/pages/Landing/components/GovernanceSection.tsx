import { ClipboardCheck, Coins, KeyRound, ScrollText, ShieldCheck, UserCheck, type LucideIcon } from "lucide-react";
import { useI18n } from "../../../i18n";
import { governanceItems } from "../landingContent";
import { Reveal, SectionHeading } from "./primitives";

const icons: LucideIcon[] = [ClipboardCheck, ScrollText, KeyRound, ShieldCheck, Coins, UserCheck];

export function GovernanceSection() {
  const { t } = useI18n();
  return (
    <section className="lp-section" aria-labelledby="lp-control-title">
      <SectionHeading
        id="lp-control-title"
        eyebrow={t("landing.governance.eyebrow")}
        title={t("landing.governance.title")}
        lead={t("landing.governance.lead")}
      />

      <Reveal className="lp-governance lp-glass">
        <ul className="lp-governance__grid">
          {governanceItems.map((item, index) => {
            const Icon = icons[index];
            return (
              <li key={item} className="lp-governance__item">
                <span className="lp-governance__icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div>
                  <h3 className="lp-governance__title">{t(`landing.governance.items.${item}.title`)}</h3>
                  <p className="lp-governance__body">{t(`landing.governance.items.${item}.body`)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Reveal>
    </section>
  );
}

export default GovernanceSection;
