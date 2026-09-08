import { useLocation, useParams } from "react-router-dom";
import { resolveBreadcrumbs } from "../app/routes";
import { Breadcrumb } from "../components/ui";

/**
 * Route-derived breadcrumbs. The trail comes from `app/routes.ts`
 * (`resolveBreadcrumbs`) — never hard-coded per page.
 */
export function Breadcrumbs() {
  const { pathname } = useLocation();
  const params = useParams();
  const items = resolveBreadcrumbs(pathname, params);
  if (items.length === 0) return null;
  return <Breadcrumb items={items} />;
}
