import { useI18n } from "../../../i18n";
import { controlPlaneBranches, coreModules } from "../landingContent";
import { PresentationNote, Reveal, SectionHeading } from "./primitives";

function ControlPlaneTree() {
  const { t } = useI18n();
  return (
    <div className="lp-tree" role="img" aria-label={t("landing.system.treeLabel")}>
      <div className="lp-tree__root lp-glass">
        <span className="lp-tree__root-dot" aria-hidden="true" />
        {t("landing.system.controlPlane")}
      </div>
      <div className="lp-tree__trunk" aria-hidden="true" />
      <div className="lp-tree__branches">
        {controlPlaneBranches.map((branch) => (
          <div key={branch.top} className="lp-tree__branch">
            <div className="lp-tree__node lp-glass">{t(branch.top)}</div>
            <div className="lp-tree__link" aria-hidden="true" />
            <div className="lp-tree__node lp-tree__node--secondary lp-glass">{t(branch.bottom)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SystemCore() {
  const { t } = useI18n();
  return (
    <div className="lp-system-core">
      <ul className="lp-system-core__modules" aria-label={t("landing.system.modulesLabel")}>
        {coreModules.map((module, index) => (
          <li
            key={module}
            className="lp-system-core__module lp-glass"
            style={{ ["--i" as string]: index }}
          >
            {t(module)}
          </li>
        ))}
      </ul>
      <div className="lp-system-core__center" aria-hidden="true">
        <div className="lp-system-core__halo" />
        <div className="lp-system-core__disc lp-glass">
          <span>AI</span>
          <span>Workforce</span>
        </div>
      </div>
    </div>
  );
}

export function SystemSection() {
  const { t } = useI18n();
  return (
    <section id="system" className="lp-section" aria-labelledby="lp-system-title">
      <SectionHeading
        id="lp-system-title"
        eyebrow={t("landing.system.eyebrow")}
        title={
          <>
            {t("landing.system.title1")}
            <br />
            {t("landing.system.title2")}
          </>
        }
        lead={t("landing.system.lead")}
      />

      <div className="lp-system-grid">
        <Reveal className="lp-panel lp-glass">
          <h3 className="lp-panel__title">{t("landing.system.coordinated")}</h3>
          <ControlPlaneTree />
        </Reveal>
        <Reveal className="lp-panel lp-glass" delay={120}>
          <h3 className="lp-panel__title">{t("landing.system.core")}</h3>
          <SystemCore />
        </Reveal>
      </div>

      <PresentationNote>{t("landing.system.note")}</PresentationNote>
    </section>
  );
}

export default SystemSection;
