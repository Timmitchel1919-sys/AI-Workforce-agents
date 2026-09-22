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
    background: 'linear-gradient(90deg,#eee,#ddd,#eee)',
    borderRadius: variant === 'circle' ? '50%' : 4,
    width,
    height,
    ...style,
  };

  return <div aria-hidden className={['ui-skeleton', className].filter(Boolean).join(' ')} style={composedStyle} />;
}

export default Skeleton;
