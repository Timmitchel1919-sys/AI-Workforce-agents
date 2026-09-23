import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { useI18n } from "../../i18n";
import { safeRedirectPath } from "../../auth/redirect";
import { BackgroundField } from "../../components/brand/BackgroundField";
import { RotatingEmblem } from "../../components/brand/RotatingEmblem";
import { LOGO_MARK_SRC } from "../../components/brand/brand";
import { Spinner } from "../../components/ui";
import { AccessPending } from "./components/AccessPending";
import { AuthAlert } from "./components/AuthFields";
import { GlobeVisual } from "./components/GlobeVisual";
import type { AuthFlowContext } from "./authFlow";
import "../../styles/os-theme.css";
import "./AuthPage.css";

function BrandCopy() {
  const { t } = useI18n();
  return (
    <>
      <p className="auth-brand__name">AI Workforce</p>
      <p className="auth-brand__tagline">Intelligence at work</p>
      <p className="auth-brand__description">
        {t("landing.hero.description")}
      </p>
      <p className="auth-brand__verbs" aria-label={t("landing.hero.verbs")}>
        <span>{t("landing.hero.architect")}</span>
        <span>{t("landing.hero.build")}</span>
        <span>{t("landing.hero.test")}</span>
        <span>{t("landing.hero.secure")}</span>
        <span>{t("landing.hero.deploy")}</span>
      </p>
    </>
  );
}

/**
 * The secure gateway between the landing page and the Control Center. The
 * brand environment persists while the card switches between sign-in,
 * sign-up, reset, and pending states.
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
    document.title = location.pathname === "/signup" ? t("auth.titleSignUp") : t("auth.titleSignIn");
  }, [location.pathname, t]);

  const flow = useMemo<AuthFlowContext>(
    () => ({ setInFlight, markAccountCreated: () => setAccountCreated(true) }),
    [],
  );

  let card;
  if (loading) {
    card = (
      <div className="auth-card auth-card--loading lp-glass" role="status" aria-live="polite">
        <Spinner />
        <span>{t("shell.verifyingSession")}</span>
      </div>
    );
  } else if (user && access === "granted" && !inFlight) {
    // Already signed in with access: go straight to the Control Center.
    return <Navigate to={next} replace />;
  } else if (user && access === "pending" && !inFlight) {
    card = <AccessPending next={next} justCreated={accountCreated} />;
  } else {
    card = (
      <div key={location.pathname} className="auth-card-swap">
        <Outlet context={flow} />
      </div>
    );
  }

  return (
    <div className="auth os-theme">
      <BackgroundField />

      <header className="auth-topbar">
        <Link to="/" className="auth-topbar__brand">
          <img src={LOGO_MARK_SRC} alt="" width={28} height={28} />
          <span>AI Workforce</span>
        </Link>
        <Link to="/" className="auth-topbar__back">
          <ArrowLeft size={14} aria-hidden="true" />
          {t("auth.backToSystem")}
        </Link>
      </header>

      <main className="auth-main">
        <aside className="auth-brand" aria-label="AI Workforce">
          <GlobeVisual />
          <div className="auth-brand__inner">
            <RotatingEmblem className="auth-emblem" />
            <BrandCopy />
          </div>
        </aside>

        <div className="auth-panel">
          <div className="auth-mobile-brand" aria-hidden="true">
            <RotatingEmblem className="auth-mobile-emblem" decorative />
            <span>AI Workforce</span>
          </div>

          {!configured ? (
            <AuthAlert tone="info">
              {t("auth.notConfigured")}
            </AuthAlert>
          ) : null}

          {card}

          <div className="auth-mobile-copy">
            <BrandCopy />
          </div>
        </div>
      </main>
    </div>
  );
}
