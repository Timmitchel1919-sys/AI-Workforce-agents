import {
  SecurityEvent,
  Vulnerability,
  AccessRequest,
} from "../../contracts/secops.js";
import { ZeroTrustPolicy } from "../../contracts/security.js";
import { ITSMControlPlane } from "../../contracts/itsm.js";

export class SecOpsService {
  private events: SecurityEvent[] = [];
  private vulnerabilities: Vulnerability[] = [];
  private policies: ZeroTrustPolicy[] = [];
  private accessRequests: AccessRequest[] = [];

  constructor(private itsmControlPlane?: ITSMControlPlane) {}

  // 1. Route Security Events (SIEM Integration Mock)
  async routeSecurityEvent(event: SecurityEvent): Promise<void> {
    if (!event.organizationId) {
      throw new Error("Tenant Isolation Violation: organizationId is required");
    }
    this.events.push(event);
    console.log(
      `[SIEM MOCK] Routed security event ${event.eventId} for org ${event.organizationId}`,
    );

    // Auto-remediate or alert based on severity
    if (event.severity === "CRITICAL") {
      console.warn(
        `[SIEM MOCK] Critical event detected! Triggering immediate response for ${event.eventId}`,
      );
    }
  }

  // 2. Evaluate Zero-Trust Policies against CMDB
  async evaluateZeroTrustPolicy(
    organizationId: string,
    policyId: string,
    ciId: string,
    _actor: string,
  ): Promise<boolean> {
    if (!organizationId)
      throw new Error("Tenant Isolation Violation: organizationId is required");

    const policy = this.policies.find(
      (p) => p.policyId === policyId && p.organizationId === organizationId,
    );
    if (!policy) {
      throw new Error(`Policy ${policyId} not found for org ${organizationId}`);
    }

    if (policy.status !== "ACTIVE") {
      return true; // If policy is not active, we might allow by default or rely on other policies. Let's return true for mock.
    }

    if (this.itsmControlPlane) {
      // Fetch CI from CMDB mock to evaluate if actor has access to it based on policy conditions
      // In a real system, we'd check if the CI attributes match the requiredConditions
      await this.itsmControlPlane.getCIDependencies(organizationId, ciId);
      // Mock evaluation:
      if (policy.requiredConditions.includes("REQUIRES_ENCRYPTION")) {
        // Check if CI or dependencies have encryption
        // (Mock: assume false for demo unless handled)
      }
    }

    if (policy.action === "DENY") {
      return false;
    }

    return true; // ALLOW or REQUIRE_MFA (handled down the line)
  }

  // Evaluate an access request
  async evaluateAccessRequest(request: AccessRequest): Promise<AccessRequest> {
    if (!request.organizationId)
      throw new Error("Tenant Isolation Violation: organizationId is required");

    // Find active policies for the target resource scope
    const activePolicies = this.policies.filter(
      (p) =>
        p.organizationId === request.organizationId &&
        p.status === "ACTIVE" &&
        (p.targetScope === "ALL" || p.targetScope === request.targetResourceId),
    );

    let finalAction = "ALLOW";
    for (const policy of activePolicies) {
      if (policy.action === "DENY") {
        finalAction = "DENY";
        break;
      }
      if (policy.action === "REQUIRE_APPROVAL") {
        finalAction = "REQUIRE_APPROVAL";
      }
    }

    if (finalAction === "DENY") {
      request.status = "DENIED";
      request.decidedAt = new Date();
      request.decidedBy = "ZeroTrustPolicyEngine";
    } else if (finalAction === "REQUIRE_APPROVAL") {
      request.status = "PENDING";
    } else {
      request.status = "APPROVED";
      request.decidedAt = new Date();
      request.decidedBy = "ZeroTrustPolicyEngine";
    }

    this.accessRequests.push(request);
    return request;
  }

  // 3. Track Vulnerability Remediation
  async registerVulnerability(vuln: Vulnerability): Promise<Vulnerability> {
    if (!vuln.organizationId)
      throw new Error("Tenant Isolation Violation: organizationId is required");
    this.vulnerabilities.push(vuln);
    return vuln;
  }

  async updateVulnerabilityStatus(
    organizationId: string,
    vulnId: string,
    status: Vulnerability["status"],
  ): Promise<Vulnerability> {
    if (!organizationId)
      throw new Error("Tenant Isolation Violation: organizationId is required");

    const vuln = this.vulnerabilities.find(
      (v) =>
        v.vulnerabilityId === vulnId && v.organizationId === organizationId,
    );
    if (!vuln) {
      throw new Error(
        `Vulnerability ${vulnId} not found in org ${organizationId}`,
      );
    }

    vuln.status = status;
    if (status === "RESOLVED") {
      vuln.remediatedAt = new Date();
    }
    return vuln;
  }

  // Data ingestion helpers
  addPolicy(policy: ZeroTrustPolicy) {
    if (!policy.organizationId)
      throw new Error("Tenant Isolation Violation: organizationId is required");
    this.policies.push(policy);
  }

  getVulnerabilities(organizationId: string): Vulnerability[] {
    return this.vulnerabilities.filter(
      (v) => v.organizationId === organizationId,
    );
  }

  getEvents(organizationId: string): SecurityEvent[] {
    return this.events.filter((e) => e.organizationId === organizationId);
  }
}
