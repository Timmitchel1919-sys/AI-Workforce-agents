import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { EntryScreen } from "../../features/projectOnboarding/components/EntryScreen";
import { useT } from "../../features/projectOnboarding/lib/useT";
import "../../features/projectOnboarding/onboarding.css";

export default function NewProjectPage() {
  const { tt, t } = useT();
  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={tt("entry.title")}
        description={tt("entry.description")}
      />
      <EntryScreen />
    </PageContainer>
  );
}
