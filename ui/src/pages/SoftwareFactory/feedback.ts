import type { MessageKey } from "../../i18n";
import { SoftwareFactoryClientError } from "../../features/softwareFactory";

/**
 * Maps a failed Software Factory command to a message key. The backend is
 * authoritative: 403/401 surface as "not allowed", 400 as "not valid", and
 * everything else as a general failure.
 */
export function commandErrorKey(error: unknown): MessageKey {
  if (error instanceof SoftwareFactoryClientError) {
    if (error.code === "FORBIDDEN" || error.code === "UNAUTHENTICATED") return "softwareFactory.commandForbidden";
    if (error.code === "INVALID") return "softwareFactory.commandInvalid";
  }
  return "softwareFactory.commandFailed";
}

/** Full human-readable message for a failed command, using the server reason. */
export function commandLabel(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  error: unknown,
): string {
  const key = commandErrorKey(error);
  const reason = error instanceof Error && error.message ? error.message : "";
  return t(key, { reason: reason || t("softwareFactory.unexpectedFailure") });
}