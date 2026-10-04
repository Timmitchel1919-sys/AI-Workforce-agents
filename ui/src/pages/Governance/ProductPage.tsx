import { Page, PageHeader, PageContent } from "../../components/ui";

export default function ProductPage() {
  return (
    <Page>
      <PageHeader title="Product Management" description="Enterprise Product Management, Product Operations & Value Delivery" />
      <PageContent>
        <div className="flex flex-col gap-6">
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Product Portfolio</h2>
            <p className="text-muted-foreground">Active products and lifecycle stages.</p>
            {/* Products list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Customer Problems</h2>
            <p className="text-muted-foreground">Validated customer problems and opportunities.</p>
            {/* Problems list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Feature Backlog</h2>
            <p className="text-muted-foreground">Product features tracked through release.</p>
            {/* Features list */}
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
