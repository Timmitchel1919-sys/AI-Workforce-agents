import { ClipboardCheck, Coins, KeyRound, ScrollText, ShieldCheck, UserCheck, type LucideIcon } from "lucide-react";
import { governanceItems } from "../landingContent";
import { Reveal, SectionHeading } from "./primitives";

const icons: LucideIcon[] = [ClipboardCheck, ScrollText, KeyRound, ShieldCheck, Coins, UserCheck];

export function GovernanceSection() {
  return (
    <section className="lp-section" aria-labelledby="lp-control-title">
      <SectionHeading
        id="lp-control-title"
        eyebrow="Control"
        title="Autonomy with control."
        lead="AI Workforce never hands agents unrestricted power. Every action passes through permissions, approvals, and an audit trail that operators own."
      />

      <Reveal className="lp-governance lp-glass">
        <ul className="lp-governance__grid">
          {governanceItems.map((item, index) => {
            const Icon = icons[index];
            return (
              <li key={item.title} className="lp-governance__item">
                <span className="lp-governance__icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div>
                  <h3 className="lp-governance__title">{item.title}</h3>
                  <p className="lp-governance__body">{item.body}</p>
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
