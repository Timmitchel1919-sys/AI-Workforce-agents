import React, { useId } from "react";
import "./ui.css";

export interface DropdownProps {
  trigger: React.ReactElement<{ onClick?: React.MouseEventHandler }>;
  children: React.ReactNode;
}

export function Dropdown({ trigger, children }: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const id = useId();
  const t = React.cloneElement(trigger, {
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      setOpen((v) => !v);
    },
  });
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
