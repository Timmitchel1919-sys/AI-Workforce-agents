import React from "react";
import "../Organizations/OrganizationPage.css";

export const TrustCenterPage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Trust Center & GRC</h1>
          <p>Enterprise compliance, risk, privacy and trust management.</p>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card">
          <div className="card-header">
            <h3>Compliance Posture</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Controls Implemented</span>
              <span className="stat-value">85%</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Evidence Current</span>
              <span className="stat-value" style={{ color: "var(--color-success)" }}>92%</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Framework Mappings</span>
              <span className="stat-value">12</span>
            </div>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Risk Register</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Open Risks</span>
              <span className="stat-value" style={{ color: "var(--color-warning)" }}>3</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Mitigating</span>
              <span className="stat-value">2</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Accepted</span>
              <span className="stat-value">0</span>
            </div>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Controls</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Active Controls</span>
              <span className="stat-value">24</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Passing Tests</span>
              <span className="stat-value" style={{ color: "var(--color-success)" }}>96%</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Exceptions Active</span>
              <span className="stat-value">1</span>
            </div>
          </div>
        </section>

        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Audit Readiness</h3>
          </div>
          <div className="card-body">
            <p style={{ marginBottom: "1rem", opacity: 0.8 }}>Internal readiness assessment based on configured controls and available evidence.</p>
            <div className="dashboard-grid">
              <div className="tenant-stat">
                <span className="stat-label">Missing Evidence</span>
                <span className="stat-value">2</span>
              </div>
              <div className="tenant-stat">
                <span className="stat-label">Stale Evidence</span>
                <span className="stat-value">0</span>
              </div>
              <div className="tenant-stat">
                <span className="stat-label">Failed Tests</span>
                <span className="stat-value">0</span>
              </div>
              <div className="tenant-stat">
                <span className="stat-label">Open Findings</span>
                <span className="stat-value">1</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
