import type { HealthSignal, ServiceInventoryRecord, Alert, PlatformConfiguration, FeatureRollout } from "../../contracts/operations.js";
import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
export declare class OperationsControlService {
    private readonly healthSignals;
    private readonly serviceInventory;
    private readonly alerts;
    private readonly platformConfigs;
    private readonly featureRollouts;
    constructor(healthSignals: Repository<HealthSignal>, serviceInventory: Repository<ServiceInventoryRecord>, alerts: Repository<Alert>, platformConfigs: Repository<PlatformConfiguration>, featureRollouts: Repository<FeatureRollout>);
    private enforcePlatformAdmin;
    getGlobalHealth(): Promise<HealthSignal[]>;
    reportHealth(operator: OperatorPrincipal, signal: Omit<HealthSignal, "id" | "observedAt">): Promise<HealthSignal>;
    listAlerts(): Promise<Alert[]>;
    acknowledgeAlert(operator: OperatorPrincipal, alertId: string): Promise<Alert>;
    applyConfiguration(operator: OperatorPrincipal, configId: string): Promise<PlatformConfiguration>;
}
