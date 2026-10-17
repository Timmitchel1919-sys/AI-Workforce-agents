import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { GlassButton } from "../../ui/GlassButton";
import { GlassCard } from "../../primitives/GlassCard";
import { GlowBorder } from "../../primitives/GlowBorder";
import { SectionContainer } from "../../primitives/SectionContainer";
import { useI18n } from "../../../i18n";
import "./sections.css";

export function FinalCTA() {
  const { t } = useI18n();
  return (
    <SectionContainer>
      <GlowBorder radius={22}>
        <GlassCard pad="lg" elevation="elevated">
          <div className="lp2-cta-shell">
            <h2 className="lp2-cta-title">{t("landing.v2.finalCta.title")}</h2>
            <p className="lp2-cta-sub">{t("landing.v2.finalCta.sub")}</p>
            <div className="lp2-cta-row">
              <Link to="/login" className="lp2-cta-link">
                <GlassButton size="lg" variant="premium" rightIcon={<ArrowRight size={16} />}>
                  {t("landing.v2.finalCta.action")}
                </GlassButton>
              </Link>
            </div>
          </div>
        </GlassCard>
      </GlowBorder>
    </SectionContainer>
  );
}
export default FinalCTA;
