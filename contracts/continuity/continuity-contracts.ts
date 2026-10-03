export type CriticalityTier = 'MISSION_CRITICAL' | 'BUSINESS_CRITICAL' | 'IMPORTANT' | 'SUPPORTING';

export interface ServiceInventory {
    id: string;
    name: string;
    tier: CriticalityTier;
    dependencies: string[]; // IDs of dependent services
    region: string;
}

export interface RtoRpoObjectives {
    rtoMinutes: number;
    rpoMinutes: number;
}

export interface BusinessImpactAnalysis {
    serviceId: string;
    financialImpactPerHour: number;
    operationalImpact: string;
    reputationalImpact: string;
    regulatoryImpact: string;
    objectives: RtoRpoObjectives;
}

export interface BackupInventory {
    backupId: string;
    serviceId: string;
    timestamp: Date;
    sizeBytes: number;
    location: string;
    status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS';
    checksum: string;
}

export interface RestoreTestResult {
    testId: string;
    backupId: string;
    serviceId: string;
    startTime: Date;
    endTime: Date;
    success: boolean;
    dataIntegrityVerified: boolean;
    timeToRestoreMinutes: number;
    remarks?: string;
}

export interface GeoResilienceModel {
    primaryRegion: string;
    secondaryRegions: string[];
    routingStrategy: 'ACTIVE_ACTIVE' | 'ACTIVE_PASSIVE' | 'GEOLOCATION';
    dataReplicationLagSeconds: number;
}

export interface FailoverStrategy {
    serviceId: string;
    triggerConditions: string[];
    targetRegion: string;
    automated: boolean;
    estimatedDowntimeMinutes: number;
}

export interface ChaosSimulationConfig {
    simulationId: string;
    targetServiceId: string;
    faultType: 'NETWORK_PARTITION' | 'LATENCY_INJECTION' | 'POD_FAILURE' | 'REGION_OUTAGE' | 'DATA_CORRUPTION';
    durationMinutes: number;
    blastRadius: string;
}

export interface ChaosSimulationResult {
    simulationId: string;
    success: boolean;
    systemResilient: boolean;
    findings: string[];
    mitigationActions: string[];
}

export interface ContinuityReadinessReport {
    timestamp: Date;
    overallStatus: 'READY' | 'AT_RISK' | 'UNPREPARED';
    servicesTracked: number;
    biaCoveragePercent: number;
    backupCompliancePercent: number;
    drTestSuccessRate: number;
    criticalGaps: string[];
}

