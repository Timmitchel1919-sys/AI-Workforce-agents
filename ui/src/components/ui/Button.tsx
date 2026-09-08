import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2, type LucideIcon } from "./icons";
import { cn } from "../../lib/utils";

export type ButtonVariant =
  "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: LucideIcon;
  iconRight?: LucideIcon;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      loading = false,
      fullWidth = false,
      iconLeft: IconLeft,
      iconRight: IconRight,
      disabled,
      className,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "ui-btn",
          `ui-btn--${variant}`,
          `ui-btn--${size}`,
          fullWidth && "ui-btn--full",
          className,
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {IconLeft ? (
          <IconLeft className="ui-btn__icon" aria-hidden="true" />
        ) : null}
        {children}
        {IconRight ? (
          <IconRight className="ui-btn__icon" aria-hidden="true" />
        ) : null}
        {loading ? (
          <span className="ui-btn__spinner" aria-hidden="true">
            <Loader2 className="ui-btn__icon ui-spinner__icon" />
          </span>
        ) : null}
      </button>
    );
  },
);

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  icon: LucideIcon;
  label: string;
  size?: ButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon: Icon, label, size = "md", className, type = "button", ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn("ui-icon-btn", `ui-icon-btn--${size}`, className)}
        aria-label={label}
        title={label}
        {...rest}
      >
        <Icon className="ui-icon-btn__icon" aria-hidden="true" />
      </button>
    );
  },
);
