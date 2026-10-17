import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { useI18n } from "../../i18n";
import { safeRedirectPath } from "../../auth/redirect";
import { PageBackground } from "../../components/primitives/PageBackground";
import { Spinner } from "../../components/ui";
import { AccessPending } from "./components/AccessPending";
import { AuthAlert } from "./components/AuthFields";
import type { AuthFlowContext } from "./authFlow";
import "../../styles/os-theme.css";
import "./AuthPage.css";

/**
 * The secure gateway between the landing page and the Control Center. Shares
 * the same primitives (PageBackground + GlassCard + GlowBorder + GlassButton)
 * as the landing so the transition reads as moving deeper into one product.
 */
export default function AuthLayout() {
  const { configured, loading, user, access } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = safeRedirectPath(params.get("next"));
  const [inFlight, setInFlight] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("os-document");
    return () => root.classList.remove("os-document");
  }, []);

  useEffect(() => {
    document.title = t("auth.titleSignIn");
  }, [location.pathname, t]);

  const flow = useMemo<AuthFlowContext>(
    () => ({ setInFlight, markAccountCreated: () => setAccountCreated(true) }),
    [],
  );

  let card;
  if (loading) {
    card = (
      <div className="auth-card auth-card--loading" role="status" aria-live="polite">
        <Spinner />
        <span>{t("shell.verifyingSession")}</span>
      </div>
    );
  } else if (user && access === "granted" && !inFlight) {
    return <Navigate to={next} replace />;
  } else if (user && access !== "granted" && access !== "none" && !inFlight) {
    card = <AccessPending next={next} justCreated={accountCreated} />;
  } else {
    card = (
      <div key={location.pathname} className="auth-card-swap">
        <Outlet context={flow} />
      </div>
    );
  }

  return (
    <div className="auth os-theme aw-bg-host">
      <PageBackground variant="beams" calm video />

      <header className="auth-topbar">
        <Link to="/" className="auth-topbar__brand" aria-label="AI Workforce home">
          <span className="auth-topbar__dot" aria-hidden />
          <span>AI Workforce</span>
        </Link>
        <Link to="/" className="auth-topbar__back">
          <ArrowLeft size={14} aria-hidden="true" />
          {t("auth.backToLanding")}
        </Link>
      </header>

      <main className="auth-main">
        <div className="auth-panel">
          {!configured ? (
            <AuthAlert tone="info">{t("auth.notConfigured")}</AuthAlert>
          ) : null}
          {card}
        </div>
      </main>
    </div>
  );
}
