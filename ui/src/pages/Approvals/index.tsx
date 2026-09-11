import { PlaceholderPage } from "../PlaceholderPage";
import { QueryStatePanel } from "../_smoke/QueryStatePanel";
import { useApprovals } from "../../features/approvals";

export function ApprovalsPage() {
  const query = useApprovals();
  return (
    <PlaceholderPage
      title="Approvals"
      description="Pending and decided approvals."
    >
      <QueryStatePanel
        label="GET /api/approvals"
        query={query}
        count={(d) => d.length}
      />
    </PlaceholderPage>
  );
}
