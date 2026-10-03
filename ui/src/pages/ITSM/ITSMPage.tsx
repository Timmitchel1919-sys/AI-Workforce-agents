import { Page, PageHeader, PageContent } from "../../components/ui";

export default function ITSMPage() {
  return (
    <Page>
      <PageHeader title="ITSM Control Plane" description="Service Management, IT Operations & CMDB" />
      <PageContent>
        <div className="flex flex-col gap-6">
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Service Portfolio</h2>
            <p className="text-muted-foreground">Manage service catalog, components, and health status.</p>
            {/* List Services here */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Incidents & Problems</h2>
            <p className="text-muted-foreground">Track and manage active incidents and known problems.</p>
            {/* List Incidents here */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Changes & Releases</h2>
            <p className="text-muted-foreground">Schedule changes and verify release deployments.</p>
            {/* List Changes here */}
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
