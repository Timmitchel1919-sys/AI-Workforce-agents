import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useHeroScrollProgress } from "../hooks/useLandingMotion";
import { CONTROL_CENTER_ROUTE, scrollToSection } from "../landingActions";
import { EarthHorizon } from "../../../components/brand/EmblemScenery";
import { RotatingEmblem } from "../../../components/brand/RotatingEmblem";

export function HeroSection() {
  useHeroScrollProgress();

  return (
    <section id="top" className="lp-hero" aria-labelledby="lp-hero-title">
      <EarthHorizon />
      <div className="lp-hero__inner">
        <RotatingEmblem className="lp-hero-emblem" />

        <h1 id="lp-hero-title" className="lp-hero__title">
          AI Workforce
        </h1>
        <p className="lp-hero__tagline">Intelligence at work</p>
        <p className="lp-hero__product">Autonomous AI Workforce OS</p>
        <p className="lp-hero__description">
          One intelligent operating system for autonomous software engineering, multi-agent
          orchestration and controlled digital execution.
        </p>
        <p className="lp-hero__verbs" aria-label="Architect, build, test, secure, deploy">
          <span>Architect</span>
          <span>Build</span>
          <span>Test</span>
          <span>Secure</span>
          <span>Deploy</span>
        </p>

        <div className="lp-hero__actions">
          <Link to={CONTROL_CENTER_ROUTE} className="lp-button lp-button--primary lp-button--large">
            Enter Workforce
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <a
            href="#system"
            className="lp-button lp-button--secondary lp-button--large"
            onClick={(e) => scrollToSection(e, "system")}
          >
            Explore System
          </a>
        </div>
      </div>

      <a
        href="#system"
        className="lp-hero__scroll"
        aria-label="Scroll to the system overview"
        onClick={(e) => scrollToSection(e, "system")}
      >
        <ChevronDown size={20} aria-hidden="true" />
      </a>
    </section>
  );
}

export default HeroSection;
