import { createContext } from "react";
import type { NotificationContextValue } from "./types";

export const NotificationContext =
  createContext<NotificationContextValue | null>(null);
