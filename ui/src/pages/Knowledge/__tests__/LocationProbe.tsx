import { useLocation } from "react-router-dom";

/** Test-only: exposes the router location so tests can assert URL state. */
export function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}
