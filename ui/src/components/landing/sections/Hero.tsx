import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { SectionContainer } from "../../primitives";
import { CommandCenterPreview } from "./CommandCenterPreview";
import { DimensionalField } from "../../ui/DimensionalField";
import { LiquidMetalButton } from "../../ui/LiquidMetalButton";
import { useI18n } from "../../../i18n";
import "./sections.css";

export function Hero() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <SectionContainer as="section" className="lp2-hero-section lp2-hero-section--dimensional">
      <DimensionalField className="lp2-hero-bg" />
      <div className="lp2-hero">
        <div className="lp2-hero-head">
          <div className="aw-section-eyebrow">
            <ShieldCheck size={12} aria-hidden /> {t("landing.v2.hero.eyebrow")}
          </div>
          <h1 className="lp2-hero-title">
            {t("landing.v2.hero.titleA")}
            <span className="lp2-hero-accent">{t("landing.v2.hero.titleAccent")}</span>
            {t("landing.v2.hero.titleB")}
          </h1>
          <p className="lp2-hero-lede">{t("landing.v2.hero.lede")}</p>
          <div className="lp2-hero-ctas">
            <LiquidMetalButton size="lg" onClick={() => navigate("/login")}>
              {t("landing.v2.hero.enter")}
              <ArrowRight size={16} aria-hidden />
            </LiquidMetalButton>
            <Link to="#capabilities" className="lp2-cta-link">
              <LiquidMetalButton size="lg" variant="chrome">
                {t("landing.v2.hero.explore")}
              </LiquidMetalButton>
            </Link>
          </div>
          <div className="lp2-hero-meta">
            <span><b>{t("landing.v2.hero.meta1")}</b> {t("landing.v2.hero.meta1Rest")}</span>
            <span><b>{t("landing.v2.hero.meta2")}</b> {t("landing.v2.hero.meta2Rest")}</span>
            <span><b>{t("landing.v2.hero.meta3")}</b> {t("landing.v2.hero.meta3Rest")}</span>
          </div>
        </div>
        <CommandCenterPreview inline />
      </div>
    </SectionContainer>
  );
}
export default Hero;
