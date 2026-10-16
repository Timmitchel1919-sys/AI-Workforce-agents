import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useI18n } from "../../i18n";

/**
 * UI Layer 7 — honest connection state. Offline means "showing what was last
 * loaded"; it never implies a queued command was executed. The app keeps no
 * offline command queue, so there is nothing to replay on reconnect.
 */
export function ConnectionStatus() {
  const { t } = useI18n();
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      setRecovered(true);
    };
    const down = () => {
      setOnline(false);
      setRecovered(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    if (!recovered) return;
    const timer = window.setTimeout(() => setRecovered(false), 6000);
    return () => window.clearTimeout(timer);
  }, [recovered]);

  if (online && !recovered) return null;
  return (
    <p className={`connection-status${online ? " is-online" : " is-offline"}`} role="status">
      {online ? null : <WifiOff size={16} aria-hidden />}
      {online ? t("mobileCommand.connection.online") : t("mobileCommand.connection.offline")}
    </p>
  );
}
