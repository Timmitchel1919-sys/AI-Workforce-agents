import { useState } from "react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useI18n } from "../../i18n";
import "./ExtensionsPage.css";

export default function ExtensionsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState("installed");

  const tabs = [
    { id: "installed", label: "Installed Extensions" },
    { id: "catalog", label: "Extension Catalog" },
    { id: "permissions", label: "Permissions" },
    { id: "updates", label: "Updates" },
    { id: "developer", label: "Developer Center" }
  ];

  return (
    <PageContainer variant="wide">
      <PageHeader
        eyebrow={t("common.brand")}
        title="Extensions Control Center"
        description="Manage your enterprise plugins, extensions, and developer platform."
      />

      <div className="liquid-glass-container">
        <div className="liquid-glass-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`liquid-glass-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="liquid-glass-content">
          {activeTab === "installed" && (
            <div className="liquid-glass-panel">
              <h3>Installed Extensions</h3>
              <p>View and manage all active enterprise extensions.</p>
              <div className="liquid-glass-card">
                <h4>GitHub Enterprise Integration</h4>
                <p>Status: Active | Version: 2.1.0</p>
              </div>
            </div>
          )}
          {activeTab === "catalog" && (
            <div className="liquid-glass-panel">
              <h3>Extension Catalog</h3>
              <p>Discover new plugins to enhance your workforce.</p>
              <div className="liquid-glass-card">
                <h4>Jira Advanced Sync</h4>
                <p>Available for installation</p>
                <button className="liquid-glass-btn">Install</button>
              </div>
            </div>
          )}
          {activeTab === "permissions" && (
            <div className="liquid-glass-panel">
              <h3>Permissions</h3>
              <p>Configure extension access controls and sandbox policies.</p>
            </div>
          )}
          {activeTab === "updates" && (
            <div className="liquid-glass-panel">
              <h3>Updates</h3>
              <p>No updates available at this time. All extensions are up to date.</p>
            </div>
          )}
          {activeTab === "developer" && (
            <div className="liquid-glass-panel">
              <h3>Developer Center</h3>
              <p>Build, test, and publish your own enterprise extensions.</p>
              <button className="liquid-glass-btn primary">Create New Extension</button>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
