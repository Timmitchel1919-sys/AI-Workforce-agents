import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff, type LucideIcon } from "lucide-react";
import { useI18n } from "../../../i18n";

interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  icon?: LucideIcon;
  error?: string;
  hint?: ReactNode;
  trailing?: ReactNode;
  /** Optional id override; a stable generated id is used otherwise. */
  inputId?: string;
}

export function AuthField({
  label,
  icon: Icon,
  error,
  hint,
  trailing,
  inputId,
  className,
  ...inputProps
}: AuthFieldProps) {
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className={["auth-field", error ? "has-error" : "", className ?? ""].filter(Boolean).join(" ")}>
      <label className="auth-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="auth-field__control">
        {Icon ? <Icon className="auth-field__icon" size={16} aria-hidden="true" /> : null}
        <input
          id={id}
          className="auth-field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          {...inputProps}
        />
        {trailing}
      </div>
      {error ? (
        <p id={errorId} className="auth-field__error">
          {error}
        </p>
      ) : null}
      {hint ? (
        <div id={hintId} className="auth-field__hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

type PasswordFieldProps = Omit<AuthFieldProps, "type" | "trailing">;

export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  return (
    <AuthField
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          className="auth-field__toggle"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? t("auth.hide", { field: props.label.toLowerCase() }) : t("auth.show", { field: props.label.toLowerCase() })}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      }
    />
  );
}

export function AuthAlert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" | "success" }) {
  return (
    <div className={`auth-alert auth-alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
