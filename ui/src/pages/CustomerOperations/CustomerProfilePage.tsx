import React from "react";
import "../Organizations/OrganizationPage.css";

export const CustomerProfilePage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Customer Operations</h1>
          <p>360-degree view of your organization's health, SLA, and dedicated support.</p>
        </div>
        <div className="header-actions">
          <button className="primary-action">Request Success Plan</button>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card">
          <div className="card-header">
            <h3>Health & Lifecycle</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Health Score</span>
              <span className="stat-value" style={{ color: "var(--color-success)" }}>98 / 100</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Lifecycle Stage</span>
              <span className="stat-value">ACTIVE</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Success Manager</span>
              <span className="stat-value">Jane Doe (Assigned)</span>
            </div>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Service Level Agreement (SLA)</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Support Level</span>
              <span className="stat-value">Enterprise 24x7</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Urgent Target</span>
              <span className="stat-value">15 minutes</span>
            </div>
          </div>
        </section>

        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Recent Support Cases</h3>
            <button className="secondary-action">Open New Case</button>
          </div>
          <div className="card-body">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Case ID</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>CASE-00123</td>
                  <td>Agent Execution Timeout</td>
                  <td><span className="badge warning">OPEN</span></td>
                  <td>HIGH</td>
                  <td>10 mins ago</td>
                  <td>
                    <button className="secondary-action">View</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
