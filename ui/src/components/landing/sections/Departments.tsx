import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import { useI18n } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import "./sections.css";

const codes = ["cpa", "dev", "qa", "sec", "res", "ux", "ops", "fin"] as const;

export function Departments() {
  const { t } = useI18n();
  return (
    <SectionContainer
      id="workforce"
      eyebrow={t("landing.v2.departments.eyebrow")}
      title={t("landing.v2.departments.title")}
      lede={t("landing.v2.departments.lede")}
    >
      <div className="lp2-bento">
        {codes.map((code) => (
          <GlassCard key={code} pad="md">
            <div className="lp2-tile-head">{code.toUpperCase()}</div>
            <h3 className="lp2-tile-title">{t(`landing.v2.departments.names.${code}` as MessageKey)}</h3>
            <p className="lp2-tile-text">{t(`landing.v2.departments.rows.${code}` as MessageKey)}</p>
          </GlassCard>
        ))}
      </div>
    </SectionContainer>
  );
}
export default Departments;
