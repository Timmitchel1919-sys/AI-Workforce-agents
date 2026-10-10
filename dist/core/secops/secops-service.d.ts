import { SecurityEvent, Vulnerability, AccessRequest } from "../../contracts/secops.js";
import { ZeroTrustPolicy } from "../../contracts/security.js";
import { ITSMControlPlane } from "../../contracts/itsm.js";
export declare class SecOpsService {
    private itsmControlPlane?;
    private events;
    private vulnerabilities;
    private policies;
    private accessRequests;
    constructor(itsmControlPlane?: ITSMControlPlane | undefined);
    routeSecurityEvent(event: SecurityEvent): Promise<void>;
    evaluateZeroTrustPolicy(organizationId: string, policyId: string, ciId: string, _actor: string): Promise<boolean>;
    evaluateAccessRequest(request: AccessRequest): Promise<AccessRequest>;
    registerVulnerability(vuln: Vulnerability): Promise<Vulnerability>;
    updateVulnerabilityStatus(organizationId: string, vulnId: string, status: Vulnerability["status"]): Promise<Vulnerability>;
    addPolicy(policy: ZeroTrustPolicy): void;
    getVulnerabilities(organizationId: string): Vulnerability[];
    getEvents(organizationId: string): SecurityEvent[];
}
