import { X } from "lucide-react";
import type { AppNotification } from "./types";
import "./Toast.css";

export interface ToastProps {
  notification: AppNotification;
  onDismiss: (id: string) => void;
}

/** A single toast. `danger` is assertive; everything else is polite. */
export function Toast({ notification, onDismiss }: ToastProps) {
  const { id, variant, title, message } = notification;
  return (
    <div
      className={`toast toast--${variant}`}
      role={variant === "danger" ? "alert" : "status"}
    >
      <div className="toast__body">
        {title ? <p className="toast__title">{title}</p> : null}
        <p className="toast__message">{message}</p>
      </div>
      <button
        type="button"
        className="toast__close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(id)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export interface ToastViewportProps {
  notifications: readonly AppNotification[];
  onDismiss: (id: string) => void;
}

/** Fixed, themed stack of toasts. Renders nothing when the queue is empty. */
export function ToastViewport({ notifications, onDismiss }: ToastViewportProps) {
  if (notifications.length === 0) return null;
  return (
    <div className="toast-viewport" aria-label="Notifications">
      {notifications.map((notification) => (
        <Toast
          key={notification.id}
          notification={notification}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
