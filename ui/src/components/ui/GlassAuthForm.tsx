import * as React from "react";
import "./GlassAuthForm.css";

type Surface = "frost" | "tint" | "smoke" | "crystal";

export interface GlassFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  label: string;
  surface?: Surface;
  error?: boolean;
}

export const GlassField = React.forwardRef<HTMLInputElement, GlassFieldProps>(
  ({ icon, label, surface = "frost", error, className, id, ...rest }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const cls = [
      "ui-glass-field",
      surface !== "frost" ? surface : "",
      error ? "ui-glass-field-error" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div className={cls}>
        <label htmlFor={inputId} style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
          {label}
        </label>
        {icon ? <span className="ui-glass-field-icon" aria-hidden>{icon}</span> : null}
        <input ref={ref} id={inputId} className="ui-glass-field-input" {...rest} />
      </div>
    );
  },
);
GlassField.displayName = "GlassField";

export interface GlassAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  title?: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function GlassAuthForm({
  title,
  subtitle,
  footer,
  children,
  className,
  ...rest
}: GlassAuthFormProps) {
  return (
    <form className={["ui-glass-auth", className].filter(Boolean).join(" ")} {...rest}>
      {(title || subtitle) && (
        <header className="ui-glass-auth-header">
          {title && <h2 className="ui-glass-auth-title">{title}</h2>}
          {subtitle && <p className="ui-glass-auth-subtitle">{subtitle}</p>}
        </header>
      )}
      <div className="ui-glass-auth-fields">{children}</div>
      {footer && <div className="ui-glass-auth-footer">{footer}</div>}
    </form>
  );
}

export default GlassAuthForm;
