import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { AnalyticsCenter } from "../../features/platformCenters/components/Centers";
import { useT } from "../../features/platformCenters/lib/useT";
import "../../features/platformCenters/platformCenters.css";

export default function AnalyticsCenterPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("an.page.title")} description={tt("an.page.description")} />
      <AnalyticsCenter />
    </PageContainer>
  );
}
