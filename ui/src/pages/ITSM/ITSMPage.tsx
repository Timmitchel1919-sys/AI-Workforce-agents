
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { Tabs } from "../../components/ui";

export default function ITSMPage() {
  const tabs = [
    {
      id: "catalog",
      label: "Service Catalog",
      panel: (
        <div className="bg-surface rounded-lg p-6 border border-border mt-6 liquid-glass-panel">
          <h2 className="text-xl font-bold mb-4">Service Portfolio</h2>
          <p className="text-muted-foreground">Manage service catalog, components, and health status.</p>
        </div>
      )
    },
    {
      id: "incidents",
      label: "Incidents",
      panel: (
        <div className="bg-surface rounded-lg p-6 border border-border mt-6 liquid-glass-panel">
          <h2 className="text-xl font-bold mb-4">Active Incidents</h2>
          <p className="text-muted-foreground">Track and manage active incidents and outages.</p>
        </div>
      )
    },
    {
      id: "problems",
      label: "Problems",
      panel: (
        <div className="bg-surface rounded-lg p-6 border border-border mt-6 liquid-glass-panel">
          <h2 className="text-xl font-bold mb-4">Known Problems</h2>
          <p className="text-muted-foreground">Root cause analysis and problem management.</p>
        </div>
      )
    },
    {
      id: "changes",
      label: "Changes",
      panel: (
        <div className="bg-surface rounded-lg p-6 border border-border mt-6 liquid-glass-panel">
          <h2 className="text-xl font-bold mb-4">Changes & Releases</h2>
          <p className="text-muted-foreground">Schedule changes and verify release deployments.</p>
        </div>
      )
    },
    {
      id: "cmdb",
      label: "CMDB",
      panel: (
        <div className="bg-surface rounded-lg p-6 border border-border mt-6 liquid-glass-panel">
          <h2 className="text-xl font-bold mb-4">Configuration Management Database</h2>
          <p className="text-muted-foreground">Asset discovery, CI relationships, and maps.</p>
        </div>
      )
    }
  ];

  return (
    <PageContainer>
      <PageHeader title="ITSM Control Plane" description="Enterprise IT Service Management & Operations" />
      <PageSection>
        <div className="liquid-glass-dark-theme flex flex-col gap-6">
          <Tabs items={tabs} />
        </div>
      </PageSection>
    </PageContainer>
  );
}
