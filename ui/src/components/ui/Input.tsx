import React, { useId } from "react";
import "./ui.css";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
  error?: string | boolean;
}

export function Input({ label, description, error, id, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? `input-${autoId}`;
  return (
    <div className="ui-field">
      {label ? <label htmlFor={inputId}>{label}</label> : null}
      <input id={inputId} className="ui-input" aria-invalid={!!error} {...rest} />
      {description ? <div className="desc">{description}</div> : null}
      {error ? <div className="ui-error">{typeof error === 'string' ? error : 'Error'}</div> : null}
    </div>
  );
}

export default Input;
