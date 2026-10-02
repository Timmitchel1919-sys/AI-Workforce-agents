import React from "react";
import "../Organizations/OrganizationPage.css";

export const IncidentsPage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Platform Status & Incidents</h1>
          <p>Real-time service health and communication.</p>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Current System Status</h3>
          </div>
          <div className="card-body">
            <div style={{ padding: "1rem", backgroundColor: "var(--color-success-bg)", border: "1px solid var(--color-success)", borderRadius: "var(--radius-md)", color: "var(--color-success)", fontWeight: 500 }}>
              All systems are operational.
            </div>
          </div>
        </section>

        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Past Incidents</h3>
          </div>
          <div className="card-body">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Incident ID</th>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Affected Services</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>INC-0089</td>
                  <td>Elevated API Latency</td>
                  <td><span className="badge warning">MINOR</span></td>
                  <td>Execution API</td>
                  <td>Sep 15, 2026</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

