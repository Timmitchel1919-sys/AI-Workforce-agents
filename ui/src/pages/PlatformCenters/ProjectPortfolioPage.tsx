import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { ProjectPortfolio } from "../../features/platformCenters/components/Centers";
import { useT } from "../../features/platformCenters/lib/useT";
import "../../features/platformCenters/platformCenters.css";

export default function ProjectPortfolioPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("pf.page.title")} description={tt("pf.page.description")} />
      <ProjectPortfolio />
    </PageContainer>
  );
}
