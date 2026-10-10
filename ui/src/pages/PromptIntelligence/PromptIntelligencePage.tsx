import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { PromptIntelligenceWorkspace } from "../../features/promptIntelligence/components/PromptIntelligenceWorkspace";
import { useT } from "../../features/promptIntelligence/lib/useT";
import "../../features/promptIntelligence/promptIntelligence.css";

export default function PromptIntelligencePage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("page.title")} description={tt("page.description")} />
      <PromptIntelligenceWorkspace />
    </PageContainer>
  );
}
