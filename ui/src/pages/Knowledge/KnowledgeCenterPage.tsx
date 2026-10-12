import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { KnowledgeCenter } from "../../features/knowledge/components/KnowledgeCenter";
import { useT } from "../../features/knowledge/lib/useT";
import "../../features/knowledge/knowledge.css";

export default function KnowledgeCenterPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={tt("page.title")} description={tt("page.description")} />
      <KnowledgeCenter />
    </PageContainer>
  );
}
