import { Lock, FileCheck, EyeOff, GitBranch, ScrollText, Fingerprint, type LucideIcon } from "lucide-react";
import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import { useI18n } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import "./sections.css";

type PillarKey = "boundary" | "signed" | "private" | "gates" | "prov" | "sess";
const pillars: ReadonlyArray<{ key: PillarKey; icon: LucideIcon; label: string }> = [
  { key: "boundary", icon: Lock,        label: "boundary" },
  { key: "signed",   icon: FileCheck,   label: "audit" },
  { key: "private",  icon: EyeOff,      label: "privacy" },
  { key: "gates",    icon: GitBranch,   label: "governance" },
  { key: "prov",     icon: ScrollText,  label: "provenance" },
  { key: "sess",     icon: Fingerprint, label: "identity" },
];

export function Security() {
  const { t } = useI18n();
  return (
    <SectionContainer
      id="security"
      eyebrow={t("landing.v2.security.eyebrow")}
      title={t("landing.v2.security.title")}
      lede={t("landing.v2.security.lede")}
    >
      <div className="lp2-sec">
        {pillars.map(({ key, icon: Icon, label }) => (
          <GlassCard key={key} pad="md">
            <div className="lp2-tile-head"><Icon size={14} aria-hidden /> {label}</div>
            <h3 className="lp2-tile-title">{t(`landing.v2.security.pillars.${key}.title` as MessageKey)}</h3>
            <p className="lp2-tile-text">{t(`landing.v2.security.pillars.${key}.text` as MessageKey)}</p>
          </GlassCard>
        ))}
      </div>
    </SectionContainer>
  );
}
export default Security;
