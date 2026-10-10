import type {
  HealthSignal,
  ServiceInventoryRecord,
  Alert,
  PlatformConfiguration,
  FeatureRollout,
  PlatformResourceRef,
} from "../../contracts/operations.js";
import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { requireText, ValidationError } from "../../contracts/index.js";

export class OperationsControlService {
  constructor(
    private readonly healthSignals: Repository<HealthSignal>,
    private readonly serviceInventory: Repository<ServiceInventoryRecord>,
    private readonly alerts: Repository<Alert>,
    private readonly platformConfigs: Repository<PlatformConfiguration>,
    private readonly featureRollouts: Repository<FeatureRollout>
  ) {}

  private enforcePlatformAdmin(operator: OperatorPrincipal) {
    if (operator.role !== "admin") {
      throw new ValidationError("Unauthorized. Requires platform_admin role.");
    }
  }

  async getGlobalHealth(): Promise<HealthSignal[]> {
    return this.healthSignals.list();
  }

  async reportHealth(
    operator: OperatorPrincipal,
    signal: Omit<HealthSignal, "id" | "observedAt">
  ): Promise<HealthSignal> {
    this.enforcePlatformAdmin(operator);
    const newSignal: HealthSignal = {
      ...signal,
      id: `health_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      observedAt: new Date().toISOString(),
    };
    this.healthSignals.upsert(newSignal);
    return newSignal;
  }

  async listAlerts(): Promise<Alert[]> {
    return this.alerts.list();
  }

  async acknowledgeAlert(operator: OperatorPrincipal, alertId: string): Promise<Alert> {
    this.enforcePlatformAdmin(operator);
    const alert = await this.alerts.findById(alertId);
    if (!alert) throw new ValidationError("Alert not found");
    const updated = { ...alert, state: "acknowledged" as const };
    this.alerts.upsert(updated);
    return updated;
  }

  async applyConfiguration(
    operator: OperatorPrincipal,
    configId: string
  ): Promise<PlatformConfiguration> {
    this.enforcePlatformAdmin(operator);
    const config = await this.platformConfigs.findById(configId);
    if (!config) throw new ValidationError("Config not found");
    const updated = { ...config, status: "applied" as const, appliedAt: new Date().toISOString() };
    this.platformConfigs.upsert(updated);
    return updated;
  }
}
