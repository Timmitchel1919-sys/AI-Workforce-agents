import { useRef, useState, type ReactNode, type MouseEvent } from "react";
import "./LiquidMetalButton.css";

export type LiquidMetalButtonProps = {
  children?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "metal" | "chrome" | "gold";
  size?: "md" | "lg";
  ariaLabel?: string;
};

export function LiquidMetalButton({
  children,
  onClick,
  type = "button",
  variant = "metal",
  size = "md",
  ariaLabel,
}: LiquidMetalButtonProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const idRef = useRef(0);
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([]);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const id = ++idRef.current;
      const ripple = { x: event.clientX - rect.left, y: event.clientY - rect.top, id };
      setRipples((prev) => [...prev, ripple]);
      window.setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 650);
    }
    onClick?.();
  };

  return (
    <button
      ref={btnRef}
      type={type}
      onClick={handleClick}
      aria-label={ariaLabel}
      className={`lmb lmb--${variant} lmb--${size}`}
    >
      <span className="lmb__ring" aria-hidden />
      <span className="lmb__surface" aria-hidden />
      <span className="lmb__sheen" aria-hidden />
      <span className="lmb__label">{children}</span>
      <span className="lmb__ripples" aria-hidden>
        {ripples.map((r) => (
          <span
            key={r.id}
            className="lmb__ripple"
            style={{ left: `${r.x}px`, top: `${r.y}px` }}
          />
        ))}
      </span>
    </button>
  );
}

export default LiquidMetalButton;
