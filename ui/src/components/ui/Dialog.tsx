import React, { useId } from "react";
import "./ui.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}

export function Dialog({ open, onClose, title, description, children }: DialogProps) {
  const generatedId = useId();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const titleId = title ? `dialog-title-${generatedId}` : undefined;
  const descId = description ? `dialog-desc-${generatedId}` : undefined;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} style={{ position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="ui-card" role="document" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '90%' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            {title ? <h2 id={titleId}>{title}</h2> : null}
            {description ? <p id={descId} className="desc">{description}</p> : null}
          </div>
          <button aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

export default Dialog;
