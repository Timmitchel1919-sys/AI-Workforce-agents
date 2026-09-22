import React from "react";
import "./ui.css";

export interface DropdownProps {
  trigger: React.ReactElement<any, any>;
  children: React.ReactNode;
}

export function Dropdown({ trigger, children }: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const id = `dropdown-${Math.random().toString(36).slice(2,8)}`;
  const t = React.cloneElement(trigger as any, { onClick: (e: any) => { e?.preventDefault(); setOpen((v: boolean) => !v); } } as any);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {t}
      {open && (
        <div id={id} role="menu" style={{ position:'absolute', top: '100%', right:0, zIndex: 100 }}>{children}</div>
      )}
    </div>
  );
}

export default Dropdown;
