import { useSystemHealth } from "../../features/system";
import { StateMessage } from "../../components/feedback";
import { StatusDot } from "../../components/status";
import { isApiError } from "../../api";
import { titleCase } from "../../lib/formatters";

/**
 * Exercises the full data path — UI → hook → endpoint → API client → Control
 * Plane — and demonstrates the loading / error / forbidden / empty states.
 * Until a Control Plane API is running it will show the error state; that is the
 * expected UI-1 behaviour.
 */
export function SystemHealthCard() {
  const { data, isPending, isError, error, refetch } = useSystemHealth();

  if (isPending) {
    return <StateMessage tone="loading" title="Loading system health…" />;
  }

  if (isError) {
    const forbidden = isApiError(error) && error.isForbidden;
    return (
      <StateMessage
        tone={forbidden ? "forbidden" : "error"}
        title={
          forbidden
            ? "You do not have access to system health"
            : "Could not load system health"
        }
        detail={isApiError(error) ? error.message : "Unknown error"}
        action={
          <button
            type="button"
            className="btn"
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </button>
        }
      />
    );
  }

  if (data.components.length === 0) {
    return <StateMessage tone="empty" title="No health components reported" />;
  }

  return (
    <div className="card">
      <div className="card__header">
        <span>System health</span>
        <span className="badge" data-status={data.status}>
          {titleCase(data.status)}
        </span>
      </div>
      <ul className="health-list">
        {data.components.map((component) => (
          <li key={component.name} className="health-list__row">
            <StatusDot status={component.status} />
            <span className="health-list__name">
              {titleCase(component.name)}
            </span>
            <span className="health-list__detail">{component.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
