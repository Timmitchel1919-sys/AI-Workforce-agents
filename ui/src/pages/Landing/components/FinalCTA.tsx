import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { CONTROL_CENTER_ROUTE } from "../landingActions";
import { RotatingEmblem } from "../../../components/brand/RotatingEmblem";
import { Reveal } from "./primitives";

export function FinalCTA() {
  return (
    <section className="lp-section lp-final" aria-labelledby="lp-final-title">
      <Reveal className="lp-final__inner">
        <RotatingEmblem className="lp-final-emblem" decorative />
        <h2 id="lp-final-title" className="lp-final__title">
          Ready to enter the workforce?
        </h2>
        <p className="lp-final__lead">
          Open the Control Center to direct your agents, review approvals, and follow every action.
        </p>
        <Link to={CONTROL_CENTER_ROUTE} className="lp-button lp-button--primary lp-button--large">
          Enter AI Workforce
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </Reveal>
    </section>
  );
}

export default FinalCTA;
