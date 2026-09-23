import React from "react";
import "./ui.css";

export interface SkeletonProps {
  variant?: 'text' | 'rect' | 'circle';
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
  className?: string;
}

export function Skeleton({ variant = 'text', width, height, style, className }: SkeletonProps) {
  const composedStyle: React.CSSProperties = {
    // Theme-aware: works in light and dark.
    background: 'linear-gradient(90deg, var(--color-surface-muted), var(--color-border), var(--color-surface-muted))',
    borderRadius: variant === 'circle' ? '50%' : 4,
    width,
    height,
    ...style,
  };

  return <div aria-hidden className={['ui-skeleton', className].filter(Boolean).join(' ')} style={composedStyle} />;
}

export default Skeleton;
