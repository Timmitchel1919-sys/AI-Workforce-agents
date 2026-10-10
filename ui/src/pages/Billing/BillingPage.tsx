import React, { useState } from "react";
import { useI18n } from "../../i18n";
import "./BillingPage.css";

const BillingPage: React.FC = () => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"subscriptions" | "plans" | "usage" | "entitlements" | "invoices">("subscriptions");

  return (
    <div className="billing-page">
      <header className="billing-header liquid-glass-panel">
        <div className="header-content">
          <h1>{t("billing.title")}</h1>
          <p>{t("billing.description")}</p>
        </div>
        <div className="provider-status">
          <span className="pulse-dot"></span>
          {t("billing.providerNotConfigured")}
        </div>
      </header>

      <nav className="billing-tabs liquid-glass-panel">
        <button 
          className={`tab-btn ${activeTab === "subscriptions" ? "active" : ""}`}
          onClick={() => setActiveTab("subscriptions")}
        >
          {t("billing.tabs.subscriptions")}
        </button>
        <button 
          className={`tab-btn ${activeTab === "plans" ? "active" : ""}`}
          onClick={() => setActiveTab("plans")}
        >
          {t("billing.tabs.plans")}
        </button>
        <button 
          className={`tab-btn ${activeTab === "usage" ? "active" : ""}`}
          onClick={() => setActiveTab("usage")}
        >
          {t("billing.tabs.usage")}
        </button>
        <button 
          className={`tab-btn ${activeTab === "entitlements" ? "active" : ""}`}
          onClick={() => setActiveTab("entitlements")}
        >
          {t("billing.tabs.entitlements")}
        </button>
        <button 
          className={`tab-btn ${activeTab === "invoices" ? "active" : ""}`}
          onClick={() => setActiveTab("invoices")}
        >
          {t("billing.tabs.invoices")}
        </button>
      </nav>

      <div className="billing-content">
        {activeTab === "subscriptions" && (
          <section className="dashboard-card liquid-glass-panel">
            <div className="card-header">
              <h3>Active Subscriptions</h3>
            </div>
            <div className="card-body">
              <p>No active subscriptions found. The billing provider is not configured.</p>
            </div>
          </section>
        )}

        {activeTab === "plans" && (
          <section className="dashboard-card liquid-glass-panel">
            <div className="card-header">
              <h3>Available Plans</h3>
            </div>
            <div className="card-body">
              <div className="plans-grid">
                <div className="plan-card">
                  <h4>Professional</h4>
                  <p className="price">$150 / mo</p>
                  <ul>
                    <li>1,000 Execution Minutes</li>
                    <li>5 Projects</li>
                  </ul>
                  <button disabled className="btn-liquid">Upgrade</button>
                </div>
                <div className="plan-card">
                  <h4>Enterprise</h4>
                  <p className="price">Custom</p>
                  <ul>
                    <li>Unlimited Minutes</li>
                    <li>Unlimited Projects</li>
                  </ul>
                  <button disabled className="btn-liquid">Contact Sales</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "usage" && (
          <section className="dashboard-card liquid-glass-panel">
            <div className="card-header">
              <h3>Usage Metering</h3>
            </div>
            <div className="card-body">
              <div className="usage-meter">
                <div className="meter-label">
                  <span>Compute</span>
                  <span>0 / 1,000 mins</span>
                </div>
                <div className="meter-bar"><div className="meter-fill" style={{ width: '0%' }}></div></div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "entitlements" && (
          <section className="dashboard-card liquid-glass-panel">
            <div className="card-header">
              <h3>Entitlements</h3>
            </div>
            <div className="card-body">
              <table className="liquid-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Advanced Models</td>
                    <td><span className="badge warning">No Entitlement</span></td>
                  </tr>
                  <tr>
                    <td>SAML SSO</td>
                    <td><span className="badge warning">No Entitlement</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "invoices" && (
          <section className="dashboard-card liquid-glass-panel">
            <div className="card-header">
              <h3>Recent Invoices</h3>
            </div>
            <div className="card-body">
              <p>No invoices available.</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default BillingPage;

