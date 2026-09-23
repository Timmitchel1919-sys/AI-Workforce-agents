import { ClipboardCheck, Eye, Fingerprint, Layers, Lock, ShieldCheck, type LucideIcon } from "lucide-react";
import { securityItems } from "../landingContent";
import { Reveal, SectionHeading } from "./primitives";

const icons: LucideIcon[] = [Fingerprint, Lock, Layers, ClipboardCheck, Eye, ShieldCheck];

export function SecuritySection() {
  return (
    <section id="security" className="lp-section" aria-labelledby="lp-security-title">
      <SectionHeading
        id="lp-security-title"
        eyebrow="Security"
        title="Built for controlled execution."
        lead="Security is part of the architecture, not a layer on top: identity on every call, the smallest possible permissions, and nothing hidden from review."
      />

      <ul className="lp-security-grid">
        {securityItems.map((item, index) => {
          const Icon = icons[index];
          return (
            <li key={item.title}>
              <Reveal className="lp-security-card lp-glass" delay={(index % 3) * 80}>
                <span className="lp-security-card__icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <h3 className="lp-security-card__title">{item.title}</h3>
                <p className="lp-security-card__body">{item.body}</p>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default SecuritySection;
