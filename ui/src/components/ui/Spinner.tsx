import { Loader2 } from "lucide-react";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <Loader2 className="spinner__icon" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
