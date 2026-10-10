import React from "react";
import "./OrganizationPage.css";

export const SecOpsPage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Security Operations (SecOps)</h1>
          <p>Monitor security incidents, configure threat detection rules, and analyze platform vulnerabilities.</p>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Active Security Incidents</h3>
          </div>
          <div className="card-body">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Incident ID</th>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>inc_9823</code></td>
                  <td>Threat Detected: API Abuse Spike</td>
                  <td><span className="badge warning">CRITICAL</span></td>
                  <td><span className="badge">OPEN</span></td>
                  <td>5 mins ago</td>
                  <td>
                    <button className="secondary-action">Investigate</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Threat Detection Rules</h3>
            <button className="secondary-action">Add Rule</button>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Active Rules</span>
              <span className="stat-value">5</span>
            </div>
            <p className="card-helper-text" style={{ marginTop: "1rem" }}>
              Monitoring: Rate limits, Geo-fencing, DLP spikes.
            </p>
          </div>
        </section>
        
        <section className="dashboard-card">
          <div className="card-header">
            <h3>Security Posture</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Score</span>
              <span className="stat-value" style={{ color: "var(--color-success)" }}>A+</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Last Audit</span>
              <span className="stat-value">Today</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
