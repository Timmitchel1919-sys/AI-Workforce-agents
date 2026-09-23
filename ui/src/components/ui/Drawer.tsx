import React from "react";
import "./ui.css";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right';
  title?: React.ReactNode;
  children?: React.ReactNode;
}

export function Drawer({ open, onClose, side = 'right', title, children }: DrawerProps) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" style={{ position:'fixed', inset:0, background:'var(--color-overlay)' }} onClick={onClose}>
      <aside className="ui-card" style={{ width: 360, height: '100%', position:'absolute', top:0, [side]:0 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>{title}</div>
          <button aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div>{children}</div>
      </aside>
    </div>
  );
}

export default Drawer;
