import { Page, PageHeader, PageContent } from "../../components/ui";

export default function DataGovernancePage() {
  return (
    <Page>
      <PageHeader title="Data Governance" description="Information Lifecycle & Records Management" />
      <PageContent>
        <div className="flex flex-col gap-6">
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Enterprise Data Catalog</h2>
            <p className="text-muted-foreground">Manage data assets, ownership, metadata, and classification.</p>
            {/* Catalog list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Information Lifecycle</h2>
            <p className="text-muted-foreground">Retention execution, legal holds, archival, and disposition rules.</p>
            {/* Lifecycle controls */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Data Subjects & Privacy Requests</h2>
            <p className="text-muted-foreground">Governed cross-system DSR management and tracking.</p>
            {/* DSR controls */}
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
