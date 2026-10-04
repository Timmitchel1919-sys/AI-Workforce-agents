import { Page, PageHeader, PageContent } from "../../components/ui";

export default function SecurityPage() {
  return (
    <Page>
      <PageHeader title="Security & Zero Trust" description="Threat Management & Zero Trust Policies" />
      <PageContent>
        <div className="flex flex-col gap-6">
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Zero Trust Policies</h2>
            <p className="text-muted-foreground">Manage context-aware access policies and boundary rules.</p>
            {/* Policy list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Security Events</h2>
            <p className="text-muted-foreground">Monitor auth failures, policy violations, and prompt injection attempts.</p>
            {/* Event list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Threat Intelligence</h2>
            <p className="text-muted-foreground">Ingest and action IOCs (Indicators of Compromise).</p>
            {/* Threat intelligence list */}
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
