import type { UseQueryResult } from "@tanstack/react-query";
import { isApiError } from "../../api";
import {
  Alert,
  Card,
  CardBody,
  KeyValue,
  Spinner,
  StatusBadge,
} from "../../components/ui";

/**
 * UI-4 integration smoke panel — proves a real query round-trips
 * (UI → hook → endpoint → API client → Control Plane). NOT a designed page;
 * feature screens land in later phases.
 */
export function QueryStatePanel<T>({
  label,
  query,
  count,
}: {
  label: string;
  query: UseQueryResult<T>;
  count?: (data: T) => number;
}) {
  const { isPending, isFetching, isError, error, dataUpdatedAt, data } = query;
  const category = isApiError(error) ? error.category : undefined;
  const correlationId = isApiError(error) ? error.correlationId : undefined;
  const n = data !== undefined && count ? count(data) : undefined;

  return (
    <Card>
      <CardBody>
        <div
          className="ui-inline"
          style={{
            justifyContent: "space-between",
            marginBottom: "var(--space-sm)",
          }}
        >
          <strong>{label}</strong>
          {isPending ? (
            <Spinner label="Loading" />
          ) : isError ? (
            <StatusBadge status="failed" label="Error" />
          ) : (
            <StatusBadge status="healthy" label="OK" />
          )}
        </div>

        {isError ? (
          <Alert
            tone="danger"
            title={`Request failed (${category ?? "error"})`}
          >
            {isApiError(error) ? error.message : "Unknown error"}
            {correlationId ? (
              <div className="text-caption">
                correlation id: {correlationId}
              </div>
            ) : null}
          </Alert>
        ) : (
          <KeyValue
            rows={[
              { key: "state", value: isPending ? "pending" : "success" },
              { key: "fetching", value: isFetching ? "yes" : "no" },
              {
                key: "items",
                value:
                  n === undefined ? "—" : n === 0 ? "empty (0)" : String(n),
              },
              {
                key: "updated",
                value: dataUpdatedAt
                  ? new Date(dataUpdatedAt).toLocaleTimeString()
                  : "—",
              },
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}
