import { Cpu, Workflow, GitBranch, Shield, Gauge, Boxes, type LucideIcon } from "lucide-react";
import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import { useI18n } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import "./sections.css";

type TileKey = "orchestrator" | "routing" | "tools" | "boundary" | "observability" | "projects";
const tiles: ReadonlyArray<{ key: TileKey; icon: LucideIcon }> = [
  { key: "orchestrator",  icon: Cpu },
  { key: "routing",       icon: Workflow },
  { key: "tools",         icon: GitBranch },
  { key: "boundary",      icon: Shield },
  { key: "observability", icon: Gauge },
  { key: "projects",      icon: Boxes },
];

export function Capabilities() {
  const { t } = useI18n();
  return (
    <SectionContainer
      id="capabilities"
      eyebrow={t("landing.v2.capabilities.eyebrow")}
      title={t("landing.v2.capabilities.title")}
      lede={t("landing.v2.capabilities.lede")}
    >
      <div className="lp2-bento lp2-bento--3">
        {tiles.map(({ key, icon: Icon }) => (
          <GlassCard key={key} pad="md">
            <div className="lp2-tile-head"><Icon size={14} aria-hidden /> {t(`landing.v2.capabilities.${key}.head` as MessageKey)}</div>
            <h3 className="lp2-tile-title">{t(`landing.v2.capabilities.${key}.title` as MessageKey)}</h3>
            <p className="lp2-tile-text">{t(`landing.v2.capabilities.${key}.text` as MessageKey)}</p>
          </GlassCard>
        ))}
      </div>
    </SectionContainer>
  );
}
export default Capabilities;
