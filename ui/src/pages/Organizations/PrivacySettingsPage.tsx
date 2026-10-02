import React from "react";
import "./OrganizationPage.css";

export const PrivacySettingsPage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Privacy & Compliance (DLP)</h1>
          <p>Manage data loss prevention rules, retention policies, and privacy requests.</p>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Data Loss Prevention (DLP)</h3>
            <button className="secondary-action">Create Rule</button>
          </div>
          <div className="card-body">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Rule Name</th>
                  <th>Target Data</th>
                  <th>Action</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Block SSN</td>
                  <td>US Social Security Number</td>
                  <td><span className="badge warning">BLOCK</span></td>
                  <td><span className="badge success">ACTIVE</span></td>
                </tr>
                <tr>
                  <td>Redact Credit Cards</td>
                  <td>Credit Card Numbers</td>
                  <td><span className="badge">REDACT</span></td>
                  <td><span className="badge success">ACTIVE</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Data Retention Policies</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Chat History</span>
              <span className="stat-value">30 Days</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Execution Records</span>
              <span className="stat-value">90 Days</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Audit Logs</span>
              <span className="stat-value">1 Year</span>
            </div>
          </div>
        </section>
        
        <section className="dashboard-card">
          <div className="card-header">
            <h3>Data Subject Requests (DSR)</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Pending Deletions</span>
              <span className="stat-value" style={{ color: "var(--color-warning)" }}>2</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Pending Exports</span>
              <span className="stat-value">0</span>
            </div>
            <button className="secondary-action" style={{ marginTop: "1rem" }}>View Queue</button>
          </div>
        </section>
      </div>
    </div>
  );
};

