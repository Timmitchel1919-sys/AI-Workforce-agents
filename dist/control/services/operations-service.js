import { ValidationError } from "../../contracts/index.js";
export class OperationsControlService {
    healthSignals;
    serviceInventory;
    alerts;
    platformConfigs;
    featureRollouts;
    constructor(healthSignals, serviceInventory, alerts, platformConfigs, featureRollouts) {
        this.healthSignals = healthSignals;
        this.serviceInventory = serviceInventory;
        this.alerts = alerts;
        this.platformConfigs = platformConfigs;
        this.featureRollouts = featureRollouts;
    }
    enforcePlatformAdmin(operator) {
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires platform_admin role.");
        }
    }
    async getGlobalHealth() {
        return this.healthSignals.list();
    }
    async reportHealth(operator, signal) {
        this.enforcePlatformAdmin(operator);
        const newSignal = {
            ...signal,
            id: `health_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            observedAt: new Date().toISOString(),
        };
        this.healthSignals.upsert(newSignal);
        return newSignal;
    }
    async listAlerts() {
        return this.alerts.list();
    }
    async acknowledgeAlert(operator, alertId) {
        this.enforcePlatformAdmin(operator);
        const alert = await this.alerts.findById(alertId);
        if (!alert)
            throw new ValidationError("Alert not found");
        const updated = { ...alert, state: "acknowledged" };
        this.alerts.upsert(updated);
        return updated;
    }
    async applyConfiguration(operator, configId) {
        this.enforcePlatformAdmin(operator);
        const config = await this.platformConfigs.findById(configId);
        if (!config)
            throw new ValidationError("Config not found");
        const updated = {
            ...config,
            status: "applied",
            appliedAt: new Date().toISOString(),
        };
        this.platformConfigs.upsert(updated);
        return updated;
    }
}
