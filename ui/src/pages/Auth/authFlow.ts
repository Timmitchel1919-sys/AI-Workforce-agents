import { useOutletContext } from "react-router-dom";

/**
 * Shared between the auth layout and its forms. While a form is mid-flight
 * (submitting or playing the "access granted" transition) the layout must not
 * redirect or swap in another state underneath it.
 */
export interface AuthFlowContext {
  setInFlight: (inFlight: boolean) => void;
  markAccountCreated: () => void;
}

export function useAuthFlow(): AuthFlowContext {
  return useOutletContext<AuthFlowContext>();
}

/** Moves keyboard/screen-reader focus to the first invalid field after a failed submit. */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  window.requestAnimationFrame(() => {
    form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

/** Brief confirmation before entering the Control Center; skipped with reduced motion. */
export const ACCESS_GRANTED_MS = 900;
