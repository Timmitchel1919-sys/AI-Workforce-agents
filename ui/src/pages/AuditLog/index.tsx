import { PlaceholderPage } from "../PlaceholderPage";
import { QueryStatePanel } from "../_smoke/QueryStatePanel";
import { useAuditEvents } from "../../features/audit";

export function AuditLogPage() {
  const query = useAuditEvents();
  return (
    <PlaceholderPage
      title="Audit Log"
      description="Filterable, paginated audit events."
    >
      <QueryStatePanel
        label="GET /api/audit"
        query={query}
        count={(d) => d.items.length}
      />
    </PlaceholderPage>
  );
}
