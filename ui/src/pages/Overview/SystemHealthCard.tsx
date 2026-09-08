import { useSystemHealth } from "../../features/system";
import { isApiError } from "../../api";
import { titleCase } from "../../lib/formatters";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  StatusIndicator,
} from "../../components/ui";

/**
 * Exercises the full data path — UI → hook → endpoint → API client → Control
 * Plane — and demonstrates the loading / error / forbidden / empty states.
 * Until a Control Plane API is running it will show the error state.
 */
export function SystemHealthCard() {
  const { data, isPending, isError, error, refetch } = useSystemHealth();

  if (isPending) {
    return (
      <Card padded>
        <Skeleton variant="text" count={4} />
      </Card>
    );
  }

  if (isError) {
    const forbidden = isApiError(error) && error.isForbidden;
    return (
      <ErrorState
        variant={forbidden ? "forbidden" : "error"}
        title={
          forbidden
            ? "You do not have access to system health"
            : "Could not load system health"
        }
        detail={isApiError(error) ? error.message : "Unknown error"}
        action={
          <Button
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }

  if (data.components.length === 0) {
    return <EmptyState title="No health components reported" />;
  }

  return (
    <Card>
      <CardHeader actions={<StatusBadge status={data.status} />}>
        System health
      </CardHeader>
      <CardBody>
        <ul className="ui-stack" style={{ gap: "var(--space-sm)" }}>
          {data.components.map((component) => (
            <li
              key={component.name}
              className="ui-inline"
              style={{
                gap: "var(--space-md)",
                justifyContent: "space-between",
              }}
            >
              <StatusIndicator
                status={component.status}
                label={titleCase(component.name)}
              />
              <span className="text-caption">{component.detail}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
