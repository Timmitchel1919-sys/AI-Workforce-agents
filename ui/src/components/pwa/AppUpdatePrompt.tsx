import { RefreshCw } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useI18n } from "../../i18n";
import { Button } from "../ui";
import {
  activateServiceWorkerUpdate,
  getServiceWorkerUpdateSnapshot,
  subscribeToServiceWorkerUpdate,
} from "../../pwa/serviceWorker";
import "./AppUpdatePrompt.css";

export function AppUpdatePrompt() {
  const { t } = useI18n();
  const available = useSyncExternalStore(
    subscribeToServiceWorkerUpdate,
    getServiceWorkerUpdateSnapshot,
    () => false,
  );

  if (!available) return null;

  return (
    <aside className="app-update" role="status" aria-live="polite">
      <div>
        <strong>{t("shell.updateAvailable")}</strong>
        <p>{t("shell.updateDescription")}</p>
      </div>
      <Button type="button" variant="primary" onClick={activateServiceWorkerUpdate}>
        <RefreshCw size={16} aria-hidden="true" />
        {t("shell.reloadUpdate")}
      </Button>
    </aside>
  );
}
