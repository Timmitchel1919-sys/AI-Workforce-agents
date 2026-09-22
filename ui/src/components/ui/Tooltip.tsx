import React from "react";
import "./ui.css";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<any, any>;
}

export function Tooltip({ content, children }: TooltipProps) {
  // Lightweight accessible tooltip using title and aria-describedby fallback
  const id = `tooltip-${Math.random().toString(36).slice(2,8)}`;
  const child = React.cloneElement(children as any, { title: typeof content === 'string' ? content : undefined, "aria-describedby": id } as any);
  return (
    <span style={{ position: 'relative' }}>
      {child}
      <span id={id} role="tooltip" className="sr-only">{content}</span>
    </span>
  );
}

export default Tooltip;
