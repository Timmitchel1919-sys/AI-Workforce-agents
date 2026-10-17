import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { GlassButton } from "../../ui/GlassButton";
import { SectionContainer } from "../../primitives";
import { CommandCenterPreview } from "./CommandCenterPreview";
import { useI18n } from "../../../i18n";
import "./sections.css";

export function Hero() {
  const { t } = useI18n();
  return (
    <SectionContainer
      as="section"
      className="lp2-hero-section"
      eyebrow={<><ShieldCheck size={12} aria-hidden /> {t("landing.v2.hero.eyebrow")}</>}
    >
      <div className="lp2-hero">
        <div className="lp2-hero-head">
          <h1 className="lp2-hero-title">
            {t("landing.v2.hero.titleA")}
            <span className="lp2-hero-accent">{t("landing.v2.hero.titleAccent")}</span>
            {t("landing.v2.hero.titleB")}
          </h1>
          <p className="lp2-hero-lede">{t("landing.v2.hero.lede")}</p>
          <div className="lp2-hero-ctas">
            <Link to="/login" className="lp2-cta-link">
              <GlassButton size="lg" variant="premium" rightIcon={<ArrowRight size={16} />}>
                {t("landing.v2.hero.enter")}
              </GlassButton>
            </Link>
            <a href="#capabilities" className="lp2-cta-link">
              <GlassButton size="lg" variant="ghost">{t("landing.v2.hero.explore")}</GlassButton>
            </a>
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
