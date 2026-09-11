import { Card, CardBody, Skeleton } from "../../../components/ui";
import { MetricGroup } from "../../../components/ui";
import { Stack } from "../../../components/layout";

/**
 * Structured loading state for the Agents page — mirrors the real layout
 * (summary metrics, filter toolbar, registry rows) rather than a full-page
 * spinner. Uses the UI-2 Skeleton system.
 */
export function AgentsLoadingState() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Loading agents">
      <span className="visually-hidden" role="status">
        Loading the agent registry…
      </span>

      <MetricGroup>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="ui-metric">
            <Skeleton variant="text" width="4rem" />
            <Skeleton variant="text" width="2.5rem" height="1.5rem" />
          </div>
        ))}
      </MetricGroup>

      <div className="ui-inline" style={{ gap: "var(--space-sm)" }}>
        <Skeleton width="16rem" height="2.25rem" />
        <Skeleton width="9rem" height="2.25rem" />
        <Skeleton width="9rem" height="2.25rem" />
        <Skeleton width="9rem" height="2.25rem" />
      </div>

      <Card>
        <CardBody>
          <Stack gap="sm">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height="2.5rem" />
            ))}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
