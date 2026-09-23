import { EarthHorizon } from "../../../components/brand/EmblemScenery";
import { RotatingEmblem } from "../../../components/brand/RotatingEmblem";
import { useI18n } from "../../../i18n";

/**
 * Brand hero at the top of the Overview: copy on the left, the rotating
 * AI Workforce emblem over the digital Earth on the right. Presentation only —
 * it carries no workforce figures.
 */
export function OverviewHero() {
  const { t } = useI18n();

  return (
    <section className="overview-hero" aria-labelledby="overview-hero-title">
      <div className="overview-hero__copy">
        <p className="overview-hero__kicker">{t("overview.heroKicker")}</p>
        <h2 id="overview-hero-title" className="overview-hero__title">
          {t("overview.heroTitle")}
        </h2>
        <p className="overview-hero__tagline">{t("overview.heroTagline")}</p>
        <p className="overview-hero__description">{t("overview.heroDescription")}</p>
        <p className="overview-hero__verbs">{t("overview.heroVerbs")}</p>
      </div>
      <div className="overview-hero__visual" aria-hidden="true">
        <EarthHorizon />
        <RotatingEmblem className="overview-hero__emblem" decorative />
      </div>
    </section>
  );
}

export default OverviewHero;
