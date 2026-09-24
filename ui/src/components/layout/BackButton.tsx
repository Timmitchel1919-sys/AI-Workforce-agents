import { ArrowLeft } from "lucide-react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n";

interface BackButtonProps {
  /** Explicit destination; otherwise browser history, falling back to the parent route. */
  to?: string;
  label?: string;
}

/** Parent route of a pathname: `/projects/a/execution-plan` → `/projects/a`. */
function parentPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments.length > 1 ? `/${segments.slice(0, -1).join("/")}` : "/";
}

function RoutedBackButton({ to, label }: BackButtonProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!to && pathname === "/") return null;

  const goBack = () => {
    if (to) return navigate(to);
    // React Router stores the history index; 0 means this app has no page to return to.
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    return index > 0 ? navigate(-1) : navigate(parentPath(pathname));
  };

  return (
    <button type="button" className="back-button" onClick={() => void goBack()}>
      <ArrowLeft size={16} aria-hidden />
      <span>{label ?? t("common.back")}</span>
    </button>
  );
}

/** Back navigation for every page header. Renders nothing outside a router. */
export default function BackButton(props: BackButtonProps) {
  return useInRouterContext() ? <RoutedBackButton {...props} /> : null;
}
