import React from "react";

export const DeveloperPlatformPage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Developer Platform</h1>
          <p>Manage API Keys, OAuth Applications, and Webhook subscriptions.</p>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>API Keys</h3>
            <button className="primary-action">Generate New Key</button>
          </div>
          <div className="card-body">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Status</th>
                  <th>Last Used</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Production API</td>
                  <td><code>sk_live_a1b2c3d4...</code></td>
                  <td><span className="badge success">ACTIVE</span></td>
                  <td>2 mins ago</td>
                  <td>
                    <button className="secondary-action">Revoke</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Webhooks</h3>
            <button className="secondary-action">Add Endpoint</button>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Active Endpoints</span>
              <span className="stat-value">2</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Failing Endpoints</span>
              <span className="stat-value" style={{ color: "var(--color-success)" }}>0</span>
            </div>
          </div>
        </section>
        
        <section className="dashboard-card">
          <div className="card-header">
            <h3>OAuth Applications</h3>
            <button className="secondary-action">Register App</button>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Published Apps</span>
              <span className="stat-value">1</span>
            </div>
            <p className="card-helper-text" style={{ marginTop: "1rem" }}>
              Acme Internal Analytics (Client ID: oapp_123)
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};