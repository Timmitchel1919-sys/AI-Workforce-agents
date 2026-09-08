import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CircleCheck,
  Info,
  X,
  type LucideIcon,
} from "./icons";
import { IconButton } from "./Button";
import { cn } from "../../lib/utils";
import {
  ToastContext,
  type ToastApi,
  type ToastInput,
  type ToastTone,
} from "./toastContext";

interface ToastItem extends ToastInput {
  id: string;
}

const ICON: Record<ToastTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: AlertTriangle,
  danger: AlertCircle,
};

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      seq.current += 1;
      const id = `toast-${seq.current}`;
      setItems((current) => [...current, { ...input, id }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="ui-toast-region"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {items.map((item) => {
          const Icon = ICON[item.tone];
          return (
            <div
              key={item.id}
              className={cn("ui-toast", `ui-toast--${item.tone}`)}
            >
              <Icon className="ui-toast__icon" aria-hidden="true" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{item.title}</strong>
                {item.detail ? (
                  <div className="text-caption">{item.detail}</div>
                ) : null}
              </div>
              <IconButton
                icon={X}
                label="Dismiss"
                size="sm"
                onClick={() => dismiss(item.id)}
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
