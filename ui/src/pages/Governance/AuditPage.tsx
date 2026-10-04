import { Page, PageHeader, PageContent } from "../../components/ui";

export default function AuditPage() {
  return (
    <Page>
      <PageHeader title="Audit Log & AI Auditor" description="Continuous Compliance & Evidence Findings" />
      <PageContent>
        <div className="flex flex-col gap-6">
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">AI Auditor Findings</h2>
            <p className="text-muted-foreground">Continuous compliance deviations and remediations across Data, AI, and Security.</p>
            {/* Findings list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Enterprise Audit Log</h2>
            <p className="text-muted-foreground">Immutable trail of consequential lifecycle events.</p>
            {/* Audit log entries */}
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
