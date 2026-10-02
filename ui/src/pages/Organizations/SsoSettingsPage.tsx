import React from "react";
import "./OrganizationPage.css";

export const SsoSettingsPage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Single Sign-On (SSO) & SCIM</h1>
          <p>Configure enterprise identity federation, domain mapping, and automated provisioning.</p>
        </div>
        <div className="header-actions">
          <button className="primary-action">Add Identity Provider</button>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Identity Providers</h3>
          </div>
          <div className="card-body">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Provider Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Domains Mapped</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Acme Okta</td>
                  <td>SAML 2.0</td>
                  <td><span className="badge success">ACTIVE</span></td>
                  <td>acme.com, acmecorp.com</td>
                  <td>
                    <button className="secondary-action">Manage</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Directory Sync (SCIM)</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Provisioning Status</span>
              <span className="stat-value" style={{ color: "var(--color-success)" }}>ENABLED</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Last Sync Event</span>
              <span className="stat-value">2 minutes ago</span>
            </div>
            <p className="card-helper-text" style={{ marginTop: "1rem" }}>
              Groups mapped: Security Admins, Default Users
            </p>
            <button className="secondary-action" style={{ marginTop: "1rem" }}>Regenerate Token</button>
          </div>
        </section>
        
        <section className="dashboard-card">
          <div className="card-header">
            <h3>Security Policies</h3>
          </div>
          <div className="card-body">
            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label>
                <input type="checkbox" checked readOnly style={{ marginRight: "0.5rem" }} />
                Require SSO for all users on mapped domains
              </label>
            </div>
            <div className="form-group">
              <label>
                <input type="checkbox" checked readOnly style={{ marginRight: "0.5rem" }} />
                JIT (Just-In-Time) Provisioning
              </label>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

