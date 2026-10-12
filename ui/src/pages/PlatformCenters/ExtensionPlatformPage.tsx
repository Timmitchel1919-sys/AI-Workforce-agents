import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { ExtensionPlatform } from "../../features/platformCenters/components/Centers";
import { useT } from "../../features/platformCenters/lib/useT";
import "../../features/platformCenters/platformCenters.css";

export default function ExtensionPlatformPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("ext.page.title")} description={tt("ext.page.description")} />
      <ExtensionPlatform />
    </PageContainer>
  );
}
