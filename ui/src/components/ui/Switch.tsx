import React from "react";
import "./ui.css";

export interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
}

export function Switch({ label, description, id, checked, ...rest }: SwitchProps) {
  const idVal = id || `switch-${Math.random().toString(36).slice(2,8)}`;
  return (
    <div className="ui-field">
      <label htmlFor={idVal} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input role="switch" id={idVal} type="checkbox" checked={checked} {...rest} />
        <span>{label}</span>
      </label>
      {description ? <div className="desc">{description}</div> : null}
    </div>
  );
}

export default Switch;
