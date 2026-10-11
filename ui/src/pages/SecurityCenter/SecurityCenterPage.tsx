import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { SecurityCenter } from "../../features/securityCenter/components/SecurityCenter";
import { useT } from "../../features/securityCenter/lib/useT";
import "../../features/securityCenter/securityCenter.css";

export default function SecurityCenterPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("page.title")} description={tt("page.description")} />
      <SecurityCenter />
    </PageContainer>
  );
}
