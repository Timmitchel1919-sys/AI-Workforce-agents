import { useParams, Link } from "react-router-dom";
import { PlaceholderPage } from "./PlaceholderPage";

/**
 * Shared placeholder for the `:id` detail routes. Proves param + nested routing
 * works; the real detail views arrive in a later UI phase.
 */
export function DetailPlaceholderPage({
  resource,
  paramName,
  backTo,
  backLabel,
}: {
  resource: string;
  paramName: string;
  backTo: string;
  backLabel: string;
}) {
  const params = useParams();
  const id = params[paramName] ?? "";
  return (
    <PlaceholderPage
      title={`${resource} detail`}
      description={`${resource} · ${id}`}
    >
      <p>
        <Link to={backTo} className="link">
          ← Back to {backLabel}
        </Link>
      </p>
    </PlaceholderPage>
  );
}
