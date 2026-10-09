import { useContext } from "react";
import { NotificationContext } from "./notificationContext";
import type { NotificationContextValue } from "./types";

/** Access the notification queue. Must be used inside `NotificationProvider`. */
export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotifications must be used within a NotificationProvider",
    );
  }
  return context;
}
