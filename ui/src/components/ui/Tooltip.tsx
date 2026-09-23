import React, { useId } from "react";
import "./ui.css";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<{
    title?: string;
    "aria-describedby"?: string;
  }>;
}

export function Tooltip({ content, children }: TooltipProps) {
  // Lightweight accessible tooltip using title and aria-describedby fallback
  const id = useId();
  const child = React.cloneElement(children, {
    title: typeof content === 'string' ? content : undefined,
    'aria-describedby': id,
  });
  return (
    <span style={{ position: 'relative' }}>
      {child}
      <span id={id} role="tooltip" className="sr-only">{content}</span>
    </span>
  );
}

export default Tooltip;
