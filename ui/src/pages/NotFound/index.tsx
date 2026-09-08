import { useNavigate } from "react-router-dom";
import { DEFAULT_ROUTE } from "../../app/routes";
import { useDocumentTitle } from "../../hooks";
import { PageContainer } from "../../components/layout";
import { Button, EmptyState, Inbox } from "../../components/ui";

export function NotFoundPage() {
  useDocumentTitle("Not found");
  const navigate = useNavigate();
  return (
    <PageContainer>
      <EmptyState
        icon={Inbox}
        title="Page not found"
        detail="That route does not exist in the Control Center."
        action={
          <Button variant="primary" onClick={() => navigate(DEFAULT_ROUTE)}>
            Go to Overview
          </Button>
        }
      />
    </PageContainer>
  );
}
