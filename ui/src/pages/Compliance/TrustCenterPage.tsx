import { Page, PageHeader, PageContent } from "../../components/ui";

export default function TrustCenterPage() {
  return (
    <Page>
      <PageHeader title="Trust Center" description="Enterprise Compliance, Risk, Privacy & Trust Management" />
      <PageContent>
        <div className="flex flex-col gap-6">
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Compliance Frameworks</h2>
            <p className="text-muted-foreground">Map operational health against ISO 27001, SOC 2, and GDPR controls.</p>
            {/* Framework Mappings */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Enterprise Risk Register</h2>
            <p className="text-muted-foreground">Manage and track identified risks, exceptions, and treatments.</p>
            {/* Risk controls */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Privacy & Data Rights</h2>
            <p className="text-muted-foreground">Manage Data Subject Requests (DSR) and retention policies.</p>
            {/* Privacy controls */}
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
