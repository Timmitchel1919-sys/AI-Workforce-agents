import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Mail } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { authErrorMessage } from "../../auth/authErrors";
import { isValidEmail } from "../../auth/passwordPolicy";
import { safeRedirectPath } from "../../auth/redirect";
import { prefersReducedMotion } from "../../components/brand/motion";
import { AuthCard } from "./components/AuthCard";
import { AuthAlert, AuthField, PasswordField } from "./components/AuthFields";
import { ACCESS_GRANTED_MS, focusFirstInvalid, useAuthFlow } from "./authFlow";

type View = "signin" | "reset";

interface FieldErrors {
  email?: string;
  password?: string;
}

function ResetPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(undefined);
    setFormError(undefined);
    setSubmitting(true);
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setFormError(authErrorMessage(err, "reset"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      eyebrow="Secure access"
      title="Reset password"
      description="Enter your account email and we'll send a link to choose a new password."
      footer={
        <button type="button" className="auth-link" onClick={onBack}>
          Back to sign in
        </button>
      }
    >
      {sent ? (
        // Identical message whether or not an account exists for the address.
        <AuthAlert tone="success">
          If an account exists for that address, a reset link is on its way. Check your inbox.
        </AuthAlert>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <AuthField
            label="Email address"
            icon={Mail}
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            required
          />
          {formError ? <AuthAlert>{formError}</AuthAlert> : null}
          <button
            type="submit"
            className="lp-button lp-button--primary auth-submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export default function LoginPage() {
  const { signIn } = useAuth();
  const { setInFlight } = useAuthFlow();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeRedirectPath(params.get("next"));

  const [view, setView] = useState<View>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [granted, setGranted] = useState(false);
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  if (view === "reset") {
    return <ResetPassword initialEmail={email} onBack={() => setView("signin")} />;
  }

  const validate = (): FieldErrors => {
    const nextErrors: FieldErrors = {};
    if (!isValidEmail(email)) nextErrors.email = "Enter a valid email address.";
    if (!password) nextErrors.password = "Enter your password.";
    return nextErrors;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError(undefined);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(formRef.current);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setInFlight(true);
    try {
      const access = await signIn(email.trim(), password, remember);
      setPassword("");
      if (access === "granted") {
        setGranted(true);
        timerRef.current = window.setTimeout(
          () => navigate(next, { replace: true }),
          prefersReducedMotion() ? 0 : ACCESS_GRANTED_MS,
        );
        return;
      }
      // Signed in without a role: the layout shows the pending state.
      setInFlight(false);
    } catch (error) {
      setFormError(authErrorMessage(error, "signIn"));
      setInFlight(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const signupHref = params.get("next") ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  return (
    <AuthCard
      eyebrow="Secure access"
      title="Welcome back"
      description="Sign in to enter your AI Workforce."
      granted={granted}
      footer={
        <p className="auth-switch">
          New to AI Workforce?{" "}
          <Link to={signupHref} className="auth-link">
            Create account <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </p>
      }
    >
      {granted ? (
        <div className="auth-granted" role="status" aria-live="assertive">
          <span className="auth-granted__icon" aria-hidden="true">
            <Check size={22} />
          </span>
          <p className="auth-granted__title">Access granted</p>
          <p className="auth-granted__text">Entering the Control Center…</p>
        </div>
      ) : (
        <form ref={formRef} className="auth-form" onSubmit={submit} noValidate>
          <AuthField
            label="Email address"
            icon={Mail}
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            required
            autoFocus
          />
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            required
          />

          <div className="auth-row">
            <label className="auth-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span className="auth-check__box" aria-hidden="true" />
              Keep me signed in
            </label>
            <button type="button" className="auth-link" onClick={() => setView("reset")}>
              Forgot password?
            </button>
          </div>

          {formError ? <AuthAlert>{formError}</AuthAlert> : null}

          <button
            type="submit"
            className="lp-button lp-button--primary auth-submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? (
              <>
                <span className="auth-progress" aria-hidden="true" />
                Verifying…
              </>
            ) : (
              <>
                Enter Workforce
                <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
