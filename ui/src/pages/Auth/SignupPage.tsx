import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Mail, User, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import type { PasswordPolicy } from "../../auth/auth.types";
import { authErrorMessage } from "../../auth/authErrors";
import {
  DEFAULT_PASSWORD_POLICY,
  isValidEmail,
  passwordRequirements,
  passwordStrength,
} from "../../auth/passwordPolicy";
import { safeRedirectPath } from "../../auth/redirect";
import { AuthCard } from "./components/AuthCard";
import { AuthAlert, AuthField, PasswordField } from "./components/AuthFields";
import { focusFirstInvalid, useAuthFlow } from "./authFlow";

interface FieldErrors {
  displayName?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

const MAX_NAME_LENGTH = 80;

const strengthLabels = { weak: "Weak", fair: "Fair", strong: "Strong" } as const;

export default function SignupPage() {
  const { signUp, getPasswordPolicy } = useAuth();
  const { setInFlight, markAccountCreated } = useAuthFlow();
  const [params] = useSearchParams();

  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    let active = true;
    void getPasswordPolicy().then((result) => {
      if (active) setPolicy(result);
    });
    return () => {
      active = false;
    };
  }, [getPasswordPolicy]);

  const requirements = passwordRequirements(password, policy);
  const strength = passwordStrength(password, policy);

  const validate = (): FieldErrors => {
    const nextErrors: FieldErrors = {};
    if (displayName.trim().length > MAX_NAME_LENGTH) {
      nextErrors.displayName = `Use at most ${MAX_NAME_LENGTH} characters.`;
    }
    if (!isValidEmail(email)) nextErrors.email = "Enter a valid email address.";
    if (!password) nextErrors.password = "Choose a password.";
    else if (requirements.some((rule) => !rule.met)) {
      nextErrors.password = "Password does not meet the requirements.";
    }
    if (!confirm) nextErrors.confirm = "Confirm your password.";
    else if (confirm !== password) nextErrors.confirm = "Passwords do not match.";
    return nextErrors;
  };

  // After the first attempt, keep errors in sync while the user fixes them.
  const liveErrors = attempted ? validate() : errors;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;

    setAttempted(true);
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
      // No role or privilege is sent: new accounts get whatever the backend
      // assigns (today: no role claim until an administrator grants one).
      await signUp({ displayName: displayName.trim() || undefined, email: email.trim(), password });
      setPassword("");
      setConfirm("");
      markAccountCreated();
    } catch (error) {
      setFormError(authErrorMessage(error, "signUp"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setInFlight(false);
    }
  };

  const next = params.get("next");
  const loginHref = next ? `/login?next=${encodeURIComponent(safeRedirectPath(next))}` : "/login";

  return (
    <AuthCard
      eyebrow="New account"
      title="Create your account"
      description="Set up secure access to AI Workforce."
      footer={
        <p className="auth-switch">
          Already have access?{" "}
          <Link to={loginHref} className="auth-link">
            Sign in <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </p>
      }
    >
      <form ref={formRef} className="auth-form" onSubmit={submit} noValidate>
        <AuthField
          label="Full name (optional)"
          icon={User}
          type="text"
          name="name"
          autoComplete="name"
          placeholder="Your name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={liveErrors.displayName}
          maxLength={MAX_NAME_LENGTH + 20}
        />
        <AuthField
          label="Email address"
          icon={Mail}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={liveErrors.email}
          required
        />
        <PasswordField
          label="Password"
          name="new-password"
          autoComplete="new-password"
          placeholder="Choose a password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={liveErrors.password}
          required
          hint={
            <div className="auth-requirements">
              <div className="auth-strength" aria-live="polite">
                <span className="auth-requirements__title">Password requirements</span>
                {password ? (
                  <span className={`auth-strength__label auth-strength__label--${strength}`}>
                    {strengthLabels[strength]}
                  </span>
                ) : null}
              </div>
              {password ? (
                <div className={`auth-strength__bar auth-strength__bar--${strength}`} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              <ul>
                {requirements.map((rule) => (
                  <li key={rule.id} className={rule.met ? "is-met" : undefined}>
                    {rule.met ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                    <span>
                      {rule.label}
                      <span className="sr-only">{rule.met ? " — met" : " — not met"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          }
        />
        <PasswordField
          label="Confirm password"
          name="confirm-password"
          autoComplete="new-password"
          placeholder="Repeat your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={liveErrors.confirm}
          required
        />

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
              Creating account…
            </>
          ) : (
            <>
              Create account
              <ArrowRight size={16} aria-hidden="true" />
            </>
          )}
        </button>
        <p className="auth-fineprint">
          New accounts start without Control Center access. An administrator assigns your role.
        </p>
      </form>
    </AuthCard>
  );
}
