export class ProcurementService {
    vendors = new Map();
    qualifications = new Map();
    requests = new Map();
    contracts = new Map();
    licenses = new Map();
    renewals = new Map();
    // VENDOR LIFECYCLE
    async registerVendor(vendor) {
        if (this.vendors.has(vendor.vendorId)) {
            throw new Error(`Vendor ${vendor.vendorId} already exists`);
        }
        this.vendors.set(vendor.vendorId, vendor);
        return vendor;
    }
    async getVendor(organizationId, vendorId) {
        const v = this.vendors.get(vendorId);
        if (v && v.organizationId !== organizationId) {
            throw new Error("Tenant isolation violation: Cannot access vendor across organizations.");
        }
        return v;
    }
    async qualifyVendor(qualification) {
        this.qualifications.set(qualification.qualificationId, qualification);
        return qualification;
    }
    async isVendorQualifiedFor(organizationId, vendorId, scope) {
        const q = Array.from(this.qualifications.values()).find(q => q.vendorId === vendorId && q.organizationId === organizationId && q.status === "VALID");
        if (!q)
            return false;
        return q.approvedScope.includes(scope) && !q.restrictedScope.includes(scope);
    }
    // PROCUREMENT REQUESTS
    async submitRequest(request) {
        this.requests.set(request.requestId, request);
        return request;
    }
    async approveRequest(organizationId, requestId) {
        const r = this.requests.get(requestId);
        if (!r)
            throw new Error("Request not found");
        if (r.organizationId !== organizationId)
            throw new Error("Tenant isolation violation");
        r.status = "APPROVED";
        return r;
    }
    // CONTRACTS
    async addContract(contract) {
        this.contracts.set(contract.contractId, contract);
        return contract;
    }
    async getContract(organizationId, contractId, requestorHasPermission) {
        const c = this.contracts.get(contractId);
        if (!c)
            throw new Error("Contract not found");
        if (c.organizationId !== organizationId)
            throw new Error("Tenant isolation violation");
        if (!requestorHasPermission)
            throw new Error("Access Denied: Missing contract access permissions.");
        return c;
    }
    // LICENSES
    async addLicense(license) {
        this.licenses.set(license.licenseId, license);
        return license;
    }
    async assignLicense(organizationId, licenseId, count) {
        const l = this.licenses.get(licenseId);
        if (!l)
            throw new Error("License not found");
        if (l.organizationId !== organizationId)
            throw new Error("Tenant isolation violation");
        if (l.availableQuantity < count) {
            throw new Error("Not enough available licenses");
        }
        l.assignedQuantity += count;
        l.availableQuantity -= count;
        return l;
    }
    async getLicenseUtilization(organizationId, licenseId) {
        const l = this.licenses.get(licenseId);
        if (!l)
            throw new Error("License not found");
        if (l.organizationId !== organizationId)
            throw new Error("Tenant isolation violation");
        // Usage is unknown unless authoritative usage evidence is passed in. We do not infer used = assigned.
        return { assigned: l.assignedQuantity, used: "UNKNOWN" };
    }
    // RENEWALS
    async createRenewalCase(renewal) {
        this.renewals.set(renewal.renewalId, renewal);
        return renewal;
    }
    async generateRenewalRecommendation(organizationId, renewalId) {
        const r = this.renewals.get(renewalId);
        if (!r)
            throw new Error("Renewal case not found");
        if (r.organizationId !== organizationId)
            throw new Error("Tenant isolation violation");
        // In real system, AI/Rules evaluate usage, spend, risk, etc.
        // For now we set it to advisory status:
        if (!r.usageEvidenceRef || !r.performanceEvidenceRef) {
            r.recommendation = "REVIEW_REQUIRED";
        }
        else {
            r.recommendation = "RENEW"; // Just mock logic
        }
        return r;
    }
}
