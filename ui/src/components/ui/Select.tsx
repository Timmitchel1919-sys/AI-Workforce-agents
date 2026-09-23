import React, { useId } from "react";
import "./ui.css";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  description?: string;
  error?: string | boolean;
}

export function Select({ label, description, error, id, children, ...rest }: SelectProps) {
  const autoId = useId();
  const idVal = id ?? `select-${autoId}`;
  return (
    <div className="ui-field">
      {label ? <label htmlFor={idVal}>{label}</label> : null}
      <select id={idVal} className="ui-select" aria-invalid={!!error} {...rest}>{children}</select>
      {description ? <div className="desc">{description}</div> : null}
      {error ? <div className="ui-error">{typeof error === 'string' ? error : 'Error'}</div> : null}
    </div>
  );
}

export default Select;
