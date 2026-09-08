import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Check } from "./icons";
import { cn } from "../../lib/utils";

/* ---- Field wrapper (label + hint + error) ------------------------------- */
export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: FieldProps) {
  const labelNode = label ? (
    <span className="ui-field__label">
      {label}
      {required ? (
        <span className="ui-field__required" aria-hidden="true">
          *
        </span>
      ) : null}
    </span>
  ) : null;

  return (
    <div className={cn("ui-field", className)}>
      {label ? (
        htmlFor ? (
          <>
            <label className="ui-field__label" htmlFor={htmlFor}>
              {label}
              {required ? (
                <span className="ui-field__required" aria-hidden="true">
                  *
                </span>
              ) : null}
            </label>
            {children}
          </>
        ) : (
          <label className="ui-field__control">
            {labelNode}
            {children}
          </label>
        )
      ) : (
        children
      )}
      {error ? (
        <span className="ui-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="ui-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

/* ---- Input ------------------------------------------------------------- */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  inputSize?: "sm" | "md";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, inputSize = "md", className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "ui-input",
        inputSize === "sm" && "ui-input--sm",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

/* ---- Textarea -------------------------------------------------------- */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid, className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn("ui-textarea", className)}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    );
  },
);

/* ---- Select -------------------------------------------------------- */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children"
> {
  options: readonly SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ options, placeholder, invalid, className, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn("ui-select", className)}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    );
  },
);

/* ---- Checkbox ------------------------------------------------------ */
export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, className, id, ...rest }, ref) {
    const generated = useId();
    return (
      <label className={cn("ui-checkbox", className)} htmlFor={id ?? generated}>
        <input ref={ref} id={id ?? generated} type="checkbox" {...rest} />
        <span className="ui-checkbox__box" aria-hidden="true">
          <Check className="ui-checkbox__icon" />
        </span>
        <span>{label}</span>
      </label>
    );
  },
);

/* ---- Switch ------------------------------------------------------ */
export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label: ReactNode;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, className, id, ...rest },
  ref,
) {
  const generated = useId();
  return (
    <label className={cn("ui-switch", className)} htmlFor={id ?? generated}>
      <input
        ref={ref}
        id={id ?? generated}
        type="checkbox"
        role="switch"
        {...rest}
      />
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
});
