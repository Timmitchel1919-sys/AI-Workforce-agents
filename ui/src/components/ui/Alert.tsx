import React from "react";
import "./ui.css";

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> { variant?: AlertVariant; title?: React.ReactNode; }

export function Alert({ variant = 'info', title, children, ...rest }: AlertProps) {
  const palette = {
    info: {
      border: 'var(--color-border)',
      background: 'var(--color-surface-muted)',
      color: 'var(--color-text-secondary)',
    },
    success: {
      border: 'var(--color-success)',
      background: 'rgba(22, 163, 74, 0.08)',
      color: 'var(--color-success)',
    },
    warning: {
      border: 'var(--color-warning)',
      background: 'rgba(245, 158, 11, 0.1)',
      color: 'var(--color-warning)',
    },
    danger: {
      border: 'var(--color-danger)',
      background: 'rgba(220, 38, 38, 0.08)',
      color: 'var(--color-danger)',
    },
  };

  const colors = palette[variant] ?? palette.info;

  return (
    <div
      role="alert"
      style={{
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: colors.color,
        padding: '0.75rem 1rem',
        borderRadius: 8,
      }}
      {...rest}
    >
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

export default Alert;
