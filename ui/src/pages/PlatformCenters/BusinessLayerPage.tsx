import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { BusinessLayer } from "../../features/platformCenters/components/Centers";
import { useT } from "../../features/platformCenters/lib/useT";
import "../../features/platformCenters/platformCenters.css";

export default function BusinessLayerPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("biz.page.title")} description={tt("biz.page.description")} />
      <BusinessLayer />
    </PageContainer>
  );
}
