import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { useI18n, type MessageKey } from "../../i18n";

export default function GovernancePage() {
  const { t } = useI18n();

  return (
    <PageContainer variant="wide">
      <PageHeader 
        eyebrow={t("common.brand" as MessageKey)} 
        title={t("nav.governanceControls" as MessageKey)} 
        description={"Manage AI Agent policies, guardrails, and compliance limits."} 
      />
      <div className="governance-page">
        <PageSection title="Policy Management" description="Global constraints and active agent policies.">
          <div className="glass-panel" style={{ padding: "2rem", borderRadius: "12px", background: "rgba(255, 255, 255, 0.05)" }}>
            <p>Active Policies: Strict Mode</p>
            <p>Compliance Level: High</p>
            <p>No critical violations detected in the last 7 days.</p>
          </div>
        </PageSection>
      </div>
    </PageContainer>
  );
}
