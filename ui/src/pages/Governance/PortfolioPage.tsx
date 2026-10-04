import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";

export default function PortfolioPage() {
  return (
    <PageContainer>
      <PageHeader title="Portfolio & Strategy" description="Enterprise Portfolio, Program & Strategic Execution Management" />
      <PageSection>
        <div className="flex flex-col gap-6">
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Strategic Objectives (OKRs)</h2>
            <p className="text-muted-foreground">Top-level business objectives and progress.</p>
            {/* Objectives list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Enterprise Portfolios</h2>
            <p className="text-muted-foreground">Investment proposals, capacity planning, and funding allocations.</p>
            {/* Portfolios list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Programs & Delivery</h2>
            <p className="text-muted-foreground">Programs associating projects and milestones with strategic objectives.</p>
            {/* Programs list */}
          </div>
        </div>
      </PageSection>
    </PageContainer>
  );
}
