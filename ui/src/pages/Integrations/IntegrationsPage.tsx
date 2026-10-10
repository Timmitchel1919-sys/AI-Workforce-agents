import { useI18n } from "../../i18n";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import Tabs from "../../components/ui/Tabs";
import "./IntegrationsPage.css";

export default function IntegrationsPage() {
  const { t } = useI18n();

  const tabs = [
    {
      id: "connectors",
      label: t("integrations.tabs.connectors"),
      panel: <div className="integration-panel">Connectors Content</div>,
    },
    {
      id: "capabilities",
      label: t("integrations.tabs.capabilities"),
      panel: <div className="integration-panel">Capabilities Content</div>,
    },
    {
      id: "mcp",
      label: t("integrations.tabs.mcp"),
      panel: <div className="integration-panel">MCP Servers Content</div>,
    },
    {
      id: "webhooks",
      label: t("integrations.tabs.webhooks"),
      panel: <div className="integration-panel">Webhooks Content</div>,
    },
    {
      id: "credentials",
      label: t("integrations.tabs.credentials"),
      panel: <div className="integration-panel">Credentials Content</div>,
    },
    {
      id: "activity",
      label: t("integrations.tabs.activity"),
      panel: <div className="integration-panel">Activity Content</div>,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("integrations.title")}
        description={t("integrations.description")}
      />
      <PageSection>
        <div className="integrations-page">
          <Tabs items={tabs} />
        </div>
      </PageSection>
    </PageContainer>
  );
}
