import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { useI18n, type MessageKey } from "../../i18n";

export default function CostCenterPage() {
  const { t } = useI18n();

  return (
    <PageContainer variant="wide">
      <PageHeader 
        eyebrow={t("common.brand" as MessageKey)} 
        title={t("nav.costCenter" as MessageKey)} 
        description={"Monitor and control AI infrastructure and token spending."} 
      />
      <div className="cost-center-page">
        <PageSection title="Usage Metrics" description="Current billing cycle usage and token consumption.">
          <div className="glass-panel" style={{ padding: "2rem", borderRadius: "12px", background: "rgba(255, 255, 255, 0.05)" }}>
            <p>Total Estimated Cost: $4,200.00</p>
            <p>Projected Spend: $5,100.00</p>
            <p>AI Tokens Consumed: 1.2B</p>
          </div>
        </PageSection>
      </div>
    </PageContainer>
  );
}
