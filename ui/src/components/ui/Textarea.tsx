import React, { useId } from "react";
import "./ui.css";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  description?: string;
  error?: string | boolean;
}

export function Textarea({ label, description, error, id, ...rest }: TextareaProps) {
  const autoId = useId();
  const idVal = id ?? `textarea-${autoId}`;
  return (
    <div className="ui-field">
      {label ? <label htmlFor={idVal}>{label}</label> : null}
      <textarea id={idVal} className="ui-textarea" aria-invalid={!!error} {...rest} />
      {description ? <div className="desc">{description}</div> : null}
      {error ? <div className="ui-error">{typeof error === 'string' ? error : 'Error'}</div> : null}
    </div>
  );
}

export default Textarea;
