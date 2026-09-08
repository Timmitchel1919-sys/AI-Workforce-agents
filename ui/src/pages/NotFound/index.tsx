import { Link } from "react-router-dom";
import { DEFAULT_ROUTE } from "../../app/routes";
import { useDocumentTitle } from "../../hooks";

export function NotFoundPage() {
  useDocumentTitle("Not found");
  return (
    <section className="page page--centered">
      <h1 className="page-header__title">Page not found</h1>
      <p>That route does not exist in the Control Center.</p>
      <p>
        <Link to={DEFAULT_ROUTE} className="link">
          Go to Overview
        </Link>
      </p>
    </section>
  );
}
