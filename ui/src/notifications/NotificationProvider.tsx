import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NotificationContext } from "./notificationContext";
import { ToastViewport } from "./Toast";
import type {
  AppNotification,
  NotificationProviderProps,
  NotifyInput,
} from "./types";

const DEFAULT_DURATION = 5000;

function createNotificationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Global notification provider. Owns the queue, auto-dismiss timers and the
 * accessible toast viewport. Timers are always cleared so unmounting never
 * leaves a dangling callback.
 */
export function NotificationProvider({
  children,
  defaultDuration = DEFAULT_DURATION,
}: NotificationProviderProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setNotifications((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const notify = useCallback(
    (input: NotifyInput): string => {
      const id = createNotificationId();
      const duration = input.duration ?? defaultDuration;
      const notification: AppNotification = {
        id,
        variant: input.variant ?? "info",
        title: input.title,
        message: input.message,
        duration,
      };
      setNotifications((prev) => [...prev, notification]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [defaultDuration, dismiss],
  );

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setNotifications([]);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ notifications, notify, dismiss, clear }),
    [notifications, notify, dismiss, clear],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ToastViewport notifications={notifications} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
}
