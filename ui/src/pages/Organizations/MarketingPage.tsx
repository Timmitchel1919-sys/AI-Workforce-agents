import React from "react";
import "./OrganizationPage.css";

export const MarketingPage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Marketing & Growth</h1>
          <p>Manage campaigns, track leads, and optimize conversion pipelines.</p>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Active Campaigns</h3>
            <button className="primary-action">New Campaign</button>
          </div>
          <div className="card-body">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Budget</th>
                  <th>Conversions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Q4 Enterprise Launch</td>
                  <td><span className="badge success">ACTIVE</span></td>
                  <td>$50,000</td>
                  <td>142</td>
                  <td>
                    <button className="secondary-action">Report</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Lead Pipeline</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Qualified Leads</span>
              <span className="stat-value">34</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">New Leads</span>
              <span className="stat-value" style={{ color: "var(--color-warning)" }}>12</span>
            </div>
          </div>
        </section>
        
        <section className="dashboard-card">
          <div className="card-header">
            <h3>Growth Metrics</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">CAC (Cost of Acquisition)</span>
              <span className="stat-value">$352.10</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
