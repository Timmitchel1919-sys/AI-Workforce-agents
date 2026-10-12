import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { OperationsCenter } from "../../features/platformCenters/components/Centers";
import { useT } from "../../features/platformCenters/lib/useT";
import "../../features/platformCenters/platformCenters.css";

export default function OperationsCenterPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("ops.page.title")} description={tt("ops.page.description")} />
      <OperationsCenter />
    </PageContainer>
  );
}
