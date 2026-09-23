import React from "react";
import "./ui.css";

export interface PopoverProps {
  trigger: React.ReactElement<{ onClick?: React.MouseEventHandler }>;
  content: React.ReactNode;
}

export function Popover({ trigger, content }: PopoverProps) {
  const [open, setOpen] = React.useState(false);
  const t = React.cloneElement(trigger, {
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      setOpen((v) => !v);
    },
  });
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {t}
      {open && <div role="dialog" style={{ position: 'absolute', top: '100%', zIndex: 100 }}>{content}</div>}
    </div>
  );
}

export default Popover;
