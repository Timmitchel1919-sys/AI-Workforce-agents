import type { ReactNode } from "react";

export type NotificationVariant = "info" | "success" | "warning" | "danger";

export interface AppNotification {
  id: string;
  variant: NotificationVariant;
  title?: string;
  message: string;
  /** Auto-dismiss delay in ms. `0` keeps the notification until dismissed. */
  duration: number;
}

export interface NotifyInput {
  message: string;
  variant?: NotificationVariant;
  title?: string;
  duration?: number;
}

export interface NotificationContextValue {
  notifications: readonly AppNotification[];
  /** Show a notification. Returns its id. */
  notify: (input: NotifyInput) => string;
  dismiss: (id: string) => void;
  /** Dismiss every visible notification. */
  clear: () => void;
}

export interface NotificationProviderProps {
  children: ReactNode;
  /** Default auto-dismiss delay applied when `notify` omits `duration`. */
  defaultDuration?: number;
}
