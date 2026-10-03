import { useState } from "react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import "./ContinuityPage.css";

const TABS = [
  "Overview",
  "Critical Services",
  "BIA",
  "Dependencies",
  "Recovery Objectives",
  "Backups",
  "Exercises",
  "Failover",
  "Geo-Resilience",
];

export default function ContinuityPage() {
  const [activeTab, setActiveTab] = useState(TABS[0]);

  return (
    <PageContainer variant="wide">
      <PageHeader 
        eyebrow="Resilience" 
        title="Enterprise Continuity Control Center" 
        description="Business Continuity, Disaster Recovery, and Geo-Resilience Control Plane" 
      />
      
      <div className="liquid-glass-dark-theme continuity-container">
        <div className="continuity-tabs">
          {TABS.map(tab => (
            <button 
              key={tab} 
              className={`continuity-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        
        <PageSection>
          <div className="continuity-content">
            <h2 className="liquid-glass-title">{activeTab}</h2>
            <div className="liquid-glass-panel">
              <p>Operational data and controls for {activeTab}.</p>
              <div className="liquid-glass-placeholder">
                 <div className="spinner-placeholder" />
                 <span>Monitoring resilient systems...</span>
              </div>
            </div>
          </div>
        </PageSection>
      </div>
    </PageContainer>
  );
}

