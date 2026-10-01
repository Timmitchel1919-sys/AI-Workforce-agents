import { useState } from "react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { useI18n } from "../../i18n";
import "./OrganizationPage.css";

export default function OrganizationPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState("workspaces");

  return (
    <PageContainer variant="wide">
      <PageHeader 
        eyebrow={t("common.brand")} 
        title={t("nav.organization")} 
        description="Manage enterprise multi-tenancy, workspaces, policies, and billing." 
      />
      
      <PageSection>
        <div className="liquid-glass-panel">
          <div className="tenant-switcher">
            <label>Active Tenant:</label>
            <select className="glass-select" defaultValue="acme">
              <option value="acme">Acme Corp (Enterprise)</option>
              <option value="stark">Stark Industries (Pro)</option>
              <option value="wayne">Wayne Enterprises (Scale)</option>
            </select>
          </div>
        </div>
      </PageSection>

      <PageSection>
        <div className="liquid-glass-tabs">
          <button className={activeTab === 'workspaces' ? 'active' : ''} onClick={() => setActiveTab('workspaces')}>Workspaces</button>
          <button className={activeTab === 'members' ? 'active' : ''} onClick={() => setActiveTab('members')}>Members</button>
          <button className={activeTab === 'policies' ? 'active' : ''} onClick={() => setActiveTab('policies')}>Policies</button>
          <button className={activeTab === 'budgets' ? 'active' : ''} onClick={() => setActiveTab('budgets')}>Budgets</button>
        </div>

        <div className="liquid-glass-content mt-4">
          {activeTab === 'workspaces' && (
            <div className="glass-card">
              <h4>Workspace Isolation</h4>
              <p>Manage discrete boundaries for agent execution and resource groups.</p>
            </div>
          )}
          {activeTab === 'members' && (
            <div className="glass-card">
              <h4>Directory & RBAC</h4>
              <p>SSO mappings, identity providers, and granular access control for members.</p>
            </div>
          )}
          {activeTab === 'policies' && (
            <div className="glass-card">
              <h4>Governance Policies</h4>
              <p>Agent bounds, approval chains, regulatory compliance, and AI guardrails.</p>
            </div>
          )}
          {activeTab === 'budgets' && (
            <div className="glass-card">
              <h4>FinOps & Quotas</h4>
              <p>Token tracking, compute budgeting, cost centers, and billing administration.</p>
            </div>
          )}
        </div>
      </PageSection>
    </PageContainer>
  );
}

