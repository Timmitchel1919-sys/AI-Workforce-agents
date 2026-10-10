import React from "react";
import "../Organizations/OrganizationPage.css";

export const CommercialAdminPage: React.FC = () => {
  return (
    <div className="organization-page">
      <header className="organization-header">
        <div className="header-content">
          <h1>Commercial Administration</h1>
          <p>Global view of Plans, Pricing, and Subscriptions.</p>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-header">
            <h3>Active Subscriptions Overview</h3>
          </div>
          <div className="card-body">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Monthly MRR Est.</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Money Mind Global</td>
                  <td>Enterprise Custom</td>
                  <td><span className="badge success">ACTIVE</span></td>
                  <td>$2,500.00</td>
                  <td>
                    <button className="secondary-action">View Details</button>
                  </td>
                </tr>
                <tr>
                  <td>Acme Corp</td>
                  <td>Professional</td>
                  <td><span className="badge warning">PAST_DUE</span></td>
                  <td>$150.00</td>
                  <td>
                    <button className="secondary-action">Resolve</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="dashboard-card">
          <div className="card-header">
            <h3>Product Catalog</h3>
          </div>
          <div className="card-body">
            <div className="tenant-stat">
              <span className="stat-label">Active Products</span>
              <span className="stat-value">1</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Active Plans</span>
              <span className="stat-value">4</span>
            </div>
            <div className="tenant-stat">
              <span className="stat-label">Active Prices</span>
              <span className="stat-value">6</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
