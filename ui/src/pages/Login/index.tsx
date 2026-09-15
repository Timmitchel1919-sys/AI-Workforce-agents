import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { DEFAULT_ROUTE } from "../../app/routes";
import { useDocumentTitle } from "../../hooks";
import { messageOf } from "../../lib/utils";
import {
  Alert,
  Button,
  Card,
  CardBody,
  Field,
  Input,
  Spinner,
} from "../../components/ui";
import { Stack } from "../../components/layout";
import "./login.css";

const schema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  useDocumentTitle("Sign in");
  const { status, signInWithEmail, signInWithGoogle } = useAuth();
  const location = useLocation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

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

  async function handleGoogleSignIn() {
    setSubmitError(null);
    setGoogleSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      setSubmitError(messageOf(error));
    } finally {
      setGoogleSubmitting(false);
    }
  }

  return (
    <div className="full-page-center">
      <Card elevated style={{ width: "min(360px, 100%)" }}>
        <CardBody>
          <form onSubmit={onSubmit} noValidate>
            <Stack gap="lg">
              <div>
                <h1 className="text-h2">AI Workforce Control Center</h1>
                <p className="text-caption">Operator sign-in</p>
              </div>

              <Field label="Email" error={errors.email?.message}>
                <Input
                  type="email"
                  autoComplete="username"
                  invalid={Boolean(errors.email)}
                  {...register("email")}
                />
              </Field>

              <Field label="Password" error={errors.password?.message}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  invalid={Boolean(errors.password)}
                  {...register("password")}
                />
              </Field>

              {submitError ? (
                <Alert tone="danger" title="Sign-in failed">
                  {submitError}
                </Alert>
              ) : null}

              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={isSubmitting}
                disabled={googleSubmitting}
              >
                Sign in
              </Button>

              <div className="login-divider" role="separator">
                <span>or</span>
              </div>

              <Button
                variant="outline"
                fullWidth
                loading={googleSubmitting}
                disabled={isSubmitting}
                onClick={() => void handleGoogleSignIn()}
              >
                Continue with Google
              </Button>

              <p className="text-caption login-provider-note">
                First use creates your Google sign-in. Workforce access still
                requires an administrator-provisioned operator role.
              </p>
            </Stack>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
