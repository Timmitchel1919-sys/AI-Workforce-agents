import { useEffect } from "react";
import {
  Nav,
  Hero,
  Capabilities,
  Departments,
  Workflow,
  Integrations,
  Security,
  Projects,
  FinalCTA,
  Footer,
} from "../../components/landing/sections";
import { DimensionalField } from "../../components/ui/DimensionalField";
import { useI18n } from "../../i18n";
import "../../styles/os-theme.css";
import "./LandingPage.css";

export default function LandingPage() {
  const { t } = useI18n();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("os-document");
    return () => root.classList.remove("os-document");
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = t("landing.documentTitle");
    return () => {
      document.title = previousTitle;
    };
  }, [t]);

  return (
    <div className="lp os-theme aw-bg-host">
      <a className="lp-skip-link" href="#lp-main">
        {t("landing.skip")}
      </a>
      <DimensionalField
        className="aw-bg lp-dimensional-background"
        style={{ position: "fixed" }}
      />
      <Nav />
      <main id="lp-main" className="lp-main" tabIndex={-1}>
        <Hero />
        <Capabilities />
        <Departments />
        <Workflow />
        <Integrations />
        <Security />
        <Projects />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
