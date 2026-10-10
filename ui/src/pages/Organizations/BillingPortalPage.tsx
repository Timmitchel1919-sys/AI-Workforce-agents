import React from "react";
import "./OrganizationPage.css";

export const BillingPortalPage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Billing & Subscriptions</h1>
          <p>Manage your commercial SaaS subscription, usage, and payments.</p>
        </div>
        <div className="header-actions">
          <button className="primary-action">Upgrade Plan</button>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card">
          <div className="card-header">
            <h3>Current Plan</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Plan</span>
              <span className="stat-value">AI Workforce Professional</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Status</span>
              <span className="stat-value" style={{ color: "var(--color-success)" }}>ACTIVE</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Billing Cadence</span>
              <span className="stat-value">MONTHLY</span>
            </div>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Current Usage</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Execution Minutes</span>
              <span className="stat-value">1,200 / 2,000</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Active Projects</span>
              <span className="stat-value">3 / 10</span>
            </div>
          </div>
        </section>

        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Recent Invoices</h3>
          </div>
          <div className="card-body">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Invoice ID</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Amount Due</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>INV-2026-10-01</td>
                  <td>Sep 1 - Sep 30, 2026</td>
                  <td><span className="badge success">PAID</span></td>
                  <td>$150.00</td>
                  <td>
                    <button className="secondary-action">Download</button>
                  </td>
                </tr>
                <tr>
                  <td>INV-2026-09-01</td>
                  <td>Aug 1 - Aug 31, 2026</td>
                  <td><span className="badge success">PAID</span></td>
                  <td>$150.00</td>
                  <td>
                    <button className="secondary-action">Download</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Payment Method</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Primary Card</span>
              <span className="stat-value">Visa ending in 4242</span>
            </div>
            <p className="card-helper-text" style={{ marginTop: "1rem", color: "var(--color-text-muted)" }}>
              Payment provider integrations are simulated in this environment.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};
