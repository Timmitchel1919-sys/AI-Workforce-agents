import { useParams } from "react-router-dom";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { OnboardingWizard } from "../../features/projectOnboarding/components/OnboardingWizard";
import { useT } from "../../features/projectOnboarding/lib/useT";
import "../../features/projectOnboarding/onboarding.css";

export default function OnboardingPage() {
  const { tt, t } = useT();
  const { onboardingId = "" } = useParams();
  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={tt("wizard.title")}
        description={tt("wizard.description")}
      />
      <OnboardingWizard key={onboardingId} onboardingId={onboardingId} />
    </PageContainer>
  );
}
