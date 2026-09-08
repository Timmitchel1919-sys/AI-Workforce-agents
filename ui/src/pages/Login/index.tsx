import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { DEFAULT_ROUTE } from "../../app/routes";
import { useDocumentTitle } from "../../hooks";
import { Spinner } from "../../components/ui";
import { messageOf } from "../../lib/utils";

const schema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  useDocumentTitle("Sign in");
  const { status, signInWithEmail } = useAuth();
  const location = useLocation();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (status === "loading") {
    return (
      <div className="full-page-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }

  if (status === "authenticated") {
    const from =
      (location.state as { from?: string } | null)?.from ?? DEFAULT_ROUTE;
    return <Navigate to={from} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await signInWithEmail(values.email, values.password);
    } catch (error) {
      setSubmitError(messageOf(error));
    }
  });

  return (
    <div className="full-page-center">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <h1 className="login-card__title">AI Workforce Control Center</h1>
        <p className="login-card__subtitle">Operator sign-in</p>

        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            autoComplete="username"
            className="field__input"
            {...register("email")}
          />
          {errors.email ? (
            <span className="field__error">{errors.email.message}</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            className="field__input"
            {...register("password")}
          />
          {errors.password ? (
            <span className="field__error">{errors.password.message}</span>
          ) : null}
        </label>

        {submitError ? (
          <p className="login-card__error" role="alert">
            {submitError}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn--primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
