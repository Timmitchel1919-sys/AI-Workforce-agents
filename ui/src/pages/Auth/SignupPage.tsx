import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Mail, User, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import type { PasswordPolicy } from "../../auth/auth.types";
import { authErrorKey } from "../../auth/authErrors";
import { useI18n } from "../../i18n";
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

export default function SignupPage() {
  const { signUp, getPasswordPolicy } = useAuth();
  const { t } = useI18n();
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
      nextErrors.displayName = t("auth.validation.nameLength", { count: MAX_NAME_LENGTH });
    }
    if (!isValidEmail(email)) nextErrors.email = t("auth.validation.email");
    if (!password) nextErrors.password = t("auth.validation.choosePassword");
    else if (requirements.some((rule) => !rule.met)) {
      nextErrors.password = t("auth.validation.requirements");
    }
    if (!confirm) nextErrors.confirm = t("auth.validation.confirm");
    else if (confirm !== password) nextErrors.confirm = t("auth.validation.mismatch");
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
      setFormError(t(authErrorKey(error, "signUp")));
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
      eyebrow={t("auth.newAccount")}
      title={t("auth.createTitle")}
      description={t("auth.createDescription")}
      footer={
        <p className="auth-switch">
          {t("auth.alreadyHaveAccess")}{" "}
          <Link to={loginHref} className="auth-link">
            {t("auth.signIn")} <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </p>
      }
    >
      <form ref={formRef} className="auth-form" onSubmit={submit} noValidate>
        <AuthField
          label={t("auth.fullName")}
          icon={User}
          type="text"
          name="name"
          autoComplete="name"
          placeholder={t("auth.fullNamePlaceholder")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={liveErrors.displayName}
          maxLength={MAX_NAME_LENGTH + 20}
        />
        <AuthField
          label={t("auth.email")}
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
          label={t("auth.password")}
          name="new-password"
          autoComplete="new-password"
          placeholder={t("auth.choosePassword")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={liveErrors.password}
          required
          hint={
            <div className="auth-requirements">
              <div className="auth-strength" aria-live="polite">
                <span className="auth-requirements__title">{t("auth.requirements")}</span>
                {password ? (
                  <span className={`auth-strength__label auth-strength__label--${strength}`}>
                    {t(`auth.strength.${strength}`)}
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
                      {t(rule.labelKey, rule.params)}
                      <span className="sr-only">{rule.met ? ` — ${t("auth.met")}` : ` — ${t("auth.notMet")}`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          }
        />
        <PasswordField
          label={t("auth.confirmPassword")}
          name="confirm-password"
          autoComplete="new-password"
          placeholder={t("auth.repeatPassword")}
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
              {t("auth.creating")}
            </>
          ) : (
            <>
              {t("auth.createAccount")}
              <ArrowRight size={16} aria-hidden="true" />
            </>
          )}
        </button>
        <p className="auth-fineprint">
          {t("auth.newAccountNote")}
        </p>
      </form>
    </AuthCard>
  );
}
