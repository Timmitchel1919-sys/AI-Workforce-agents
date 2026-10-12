import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { LiveWorkspace } from "../../features/liveWorkspace/components/LiveWorkspace";
import { useT } from "../../features/liveWorkspace/lib/useT";
import "../../features/liveWorkspace/liveWorkspace.css";

export default function LiveWorkspacePage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("page.title")} description={tt("page.description")} />
      <LiveWorkspace />
    </PageContainer>
  );
}
