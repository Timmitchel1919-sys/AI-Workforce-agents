import { useEffect } from "react";
import { AgentWorkforceSection } from "./components/AgentWorkforceSection";
import { BackgroundField } from "../../components/brand/BackgroundField";
import { CommandCenterPreview } from "./components/CommandCenterPreview";
import { EnvironmentSection } from "./components/EnvironmentSection";
import { FinalCTA } from "./components/FinalCTA";
import { GovernanceSection } from "./components/GovernanceSection";
import { HeroSection } from "./components/HeroSection";
import { LandingFooter } from "./components/LandingFooter";
import { LandingNavbar } from "./components/LandingNavbar";
import { OrchestrationPipeline } from "./components/OrchestrationPipeline";
import { SecuritySection } from "./components/SecuritySection";
import { SystemSection } from "./components/SystemSection";
import "../../styles/os-theme.css";
import "./LandingPage.css";

export default function LandingPage() {
  // The landing experience is always obsidian; keep overscroll areas matching.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("os-document");
    const previousTitle = document.title;
    document.title = "AI Workforce — Intelligence at work";
    return () => {
      root.classList.remove("os-document");
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="lp os-theme">
      <a className="lp-skip-link" href="#lp-main">
        Skip to content
      </a>
      <BackgroundField />
      <LandingNavbar />
      <main id="lp-main" className="lp-main">
        <HeroSection />
        <SystemSection />
        <EnvironmentSection />
        <AgentWorkforceSection />
        <OrchestrationPipeline />
        <GovernanceSection />
        <SecuritySection />
        <CommandCenterPreview />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
