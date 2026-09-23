import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useHeroScrollProgress } from "../hooks/useLandingMotion";
import { useI18n } from "../../../i18n";
import { CONTROL_CENTER_ROUTE, scrollToSection } from "../landingActions";
import { EarthHorizon } from "../../../components/brand/EmblemScenery";
import { RotatingEmblem } from "../../../components/brand/RotatingEmblem";

export function HeroSection() {
  useHeroScrollProgress();
  const { t } = useI18n();

  return (
    <section id="top" className="lp-hero" aria-labelledby="lp-hero-title">
      <EarthHorizon />
      <div className="lp-hero__inner">
        <RotatingEmblem className="lp-hero-emblem" />

        <h1 id="lp-hero-title" className="lp-hero__title">
          {t("landing.hero.title")}
        </h1>
        <p className="lp-hero__tagline">{t("landing.hero.tagline")}</p>
        <p className="lp-hero__product">{t("landing.hero.product")}</p>
        <p className="lp-hero__description">{t("landing.hero.description")}</p>
        <p className="lp-hero__verbs" aria-label={t("landing.hero.verbs")}>
          <span>{t("landing.hero.architect")}</span>
          <span>{t("landing.hero.build")}</span>
          <span>{t("landing.hero.test")}</span>
          <span>{t("landing.hero.secure")}</span>
          <span>{t("landing.hero.deploy")}</span>
        </p>

        <div className="lp-hero__actions">
          <Link to={CONTROL_CENTER_ROUTE} className="lp-button lp-button--primary lp-button--large">
            {t("landing.hero.enter")}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <a
            href="#system"
            className="lp-button lp-button--secondary lp-button--large"
            onClick={(e) => scrollToSection(e, "system")}
          >
            {t("landing.hero.explore")}
          </a>
        </div>
      </div>

      <a
        href="#system"
        className="lp-hero__scroll"
        aria-label={t("landing.hero.scroll")}
        onClick={(e) => scrollToSection(e, "system")}
      >
        <ChevronDown size={20} aria-hidden="true" />
      </a>
    </section>
  );
}

export default HeroSection;
