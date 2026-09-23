import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { CONTROL_CENTER_ROUTE } from "../landingActions";
import { RotatingEmblem } from "../../../components/brand/RotatingEmblem";
import { Reveal } from "./primitives";
import { useI18n } from "../../../i18n";

export function FinalCTA() {
  const { t } = useI18n();
  return (
    <section className="lp-section lp-final" aria-labelledby="lp-final-title">
      <Reveal className="lp-final__inner">
        <RotatingEmblem className="lp-final-emblem" decorative />
        <h2 id="lp-final-title" className="lp-final__title">
          {t("landing.final.title")}
        </h2>
        <p className="lp-final__lead">
          {t("landing.final.lead")}
        </p>
        <Link to={CONTROL_CENTER_ROUTE} className="lp-button lp-button--primary lp-button--large">
          {t("landing.final.cta")}
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </Reveal>
    </section>
  );
}

export default FinalCTA;
