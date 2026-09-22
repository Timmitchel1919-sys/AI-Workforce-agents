import React from "react";
import "./ui.css";

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
}

export function Checkbox({ label, description, id, ...rest }: CheckboxProps) {
  const idVal = id || `checkbox-${Math.random().toString(36).slice(2,8)}`;
  return (
    <div className="ui-field">
      <label htmlFor={idVal} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id={idVal} type="checkbox" {...rest} />
        <span>{label}</span>
      </label>
      {description ? <div className="desc">{description}</div> : null}
    </div>
  );
}

export default Checkbox;
