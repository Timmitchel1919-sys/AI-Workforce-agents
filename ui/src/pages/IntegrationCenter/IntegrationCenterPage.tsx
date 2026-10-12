import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { IntegrationCenter } from "../../features/integrationCenter/components/IntegrationCenter";
import { useT } from "../../features/integrationCenter/lib/useT";
import "../../features/integrationCenter/integrationCenter.css";

export default function IntegrationCenterPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("page.title")} description={tt("page.description")} />
      <IntegrationCenter />
    </PageContainer>
  );
}
