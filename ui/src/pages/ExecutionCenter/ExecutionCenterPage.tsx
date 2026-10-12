import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { ExecutionCenterWorkspace } from "../../features/executionOrchestration/components/ExecutionCenterWorkspace";
import { useT } from "../../features/executionOrchestration/lib/useT";
import "../../features/executionOrchestration/executionOrchestration.css";

export default function ExecutionCenterPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("page.title")} description={tt("page.description")} />
      <ExecutionCenterWorkspace />
    </PageContainer>
  );
}
