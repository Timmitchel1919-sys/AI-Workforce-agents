import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import { useI18n } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import "./sections.css";

const stepKeys = ["intake", "plan", "route", "execute", "audit", "deploy"] as const;

export function Workflow() {
  const { t } = useI18n();
  return (
    <SectionContainer
      id="workflow"
      eyebrow={t("landing.v2.workflow.eyebrow")}
      title={t("landing.v2.workflow.title")}
      lede={t("landing.v2.workflow.lede")}
    >
      <GlassCard pad="md">
        <div className="lp2-workflow">
          {stepKeys.map((key) => (
            <div key={key} className="lp2-workflow-row">
              <b>{t(`landing.v2.workflow.steps.${key}.phase` as MessageKey)}</b>
              <p>
                <strong style={{ color: "var(--foreground)" }}>{t(`landing.v2.workflow.steps.${key}.name` as MessageKey)}.</strong>{" "}
                {t(`landing.v2.workflow.steps.${key}.desc` as MessageKey)}
              </p>
              <span className="aw-cmd-chip cyan">{t("landing.v2.workflow.live")}</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </SectionContainer>
  );
}
export default Workflow;
