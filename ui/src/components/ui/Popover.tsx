import React from "react";
import "./ui.css";

export interface PopoverProps {
  trigger: React.ReactElement<any, any>;
  content: React.ReactNode;
}

export function Popover({ trigger, content }: PopoverProps) {
  const [open, setOpen] = React.useState(false);
  const t = React.cloneElement(trigger as any, { onClick: (e: any) => { e?.preventDefault(); setOpen((v: boolean) => !v); } } as any);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {t}
      {open && <div role="dialog" style={{ position: 'absolute', top: '100%', zIndex: 100 }}>{content}</div>}
    </div>
  );
}

export default Popover;
