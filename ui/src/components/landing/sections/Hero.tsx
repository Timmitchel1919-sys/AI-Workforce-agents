import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { GlassButton } from "../../ui/GlassButton";
import { SectionContainer } from "../../primitives";
import { CommandCenterPreview } from "./CommandCenterPreview";
import "./sections.css";

export function Hero() {
  return (
    <SectionContainer as="section" className="lp2-hero-section">
      <div className="lp2-hero">
        <div className="lp2-hero-head">
          <div className="aw-section-eyebrow">
            <ShieldCheck size={12} aria-hidden /> Private operating system
          </div>
          <h1 className="lp2-hero-title">
            Run your work as a <span className="lp2-hero-accent">coordinated workforce</span> of agents.
          </h1>
          <p className="lp2-hero-lede">
            AI Workforce is a private operating system for autonomous teams: a single command center
            that plans, routes, executes, and audits every task across your projects, models, and tools.
          </p>
          <div className="lp2-hero-ctas">
            <Link to="/login" style={{ textDecoration: "none" }}>
              <GlassButton size="lg" variant="premium" rightIcon={<ArrowRight size={16} />}>
                Enter Workforce
              </GlassButton>
            </Link>
            <a href="#capabilities" style={{ textDecoration: "none" }}>
              <GlassButton size="lg" variant="ghost">See the system</GlassButton>
            </a>
          </div>
          <div className="lp2-hero-meta">
            <span><b>SOC-grade</b> boundary</span>
            <span><b>Audit</b> every action</span>
            <span><b>Private</b> single-tenant</span>
          </div>
        </div>
        <CommandCenterPreview inline />
      </div>
    </SectionContainer>
  );
}
export default Hero;
