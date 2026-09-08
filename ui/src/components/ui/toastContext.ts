import { createContext, useContext } from "react";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastInput {
  tone: ToastTone;
  title: string;
  detail?: string;
}

export interface ToastApi {
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}
