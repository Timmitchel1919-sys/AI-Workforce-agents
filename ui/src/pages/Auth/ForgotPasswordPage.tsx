import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { authErrorKey } from "../../auth/authErrors";
import { useI18n } from "../../i18n";
import { isValidEmail } from "../../auth/passwordPolicy";
import { AuthCard } from "./components/AuthCard";
import { AuthAlert, AuthField } from "./components/AuthFields";

/**
 * Dedicated /forgot-password route. Rendered directly in reset mode so the
 * URL drives the form state (no transient signin flash).
 */
export default function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!isValidEmail(email)) {
      setError(t("auth.validation.email"));
      return;
    }
    setError(undefined);
    setFormError(undefined);
    setSubmitting(true);
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setFormError(t(authErrorKey(err, "reset")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      eyebrow={t("auth.secureAccess")}
      title={t("auth.resetTitle")}
      description={t("auth.resetDescription")}
      footer={
        <Link to="/login" className="auth-link">
          {t("auth.backToSignIn")}
        </Link>
      }
    >
      {sent ? (
        <AuthAlert tone="success">{t("auth.resetSent")}</AuthAlert>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <AuthField
            label={t("auth.email")}
            icon={Mail}
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            required
            autoFocus
          />
          {formError ? <AuthAlert>{formError}</AuthAlert> : null}
          <button
            type="submit"
            className="auth-submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? (
              <>
                <span className="auth-progress" aria-hidden="true" />
                {t("auth.sending")}
              </>
            ) : (
              t("auth.sendReset")
            )}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
