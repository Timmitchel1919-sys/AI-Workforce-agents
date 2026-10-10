import { Vendor, VendorQualification, ProcurementRequest, ContractRecord, SoftwareLicense, RenewalCase } from "../../contracts/procurement.js";
export declare class ProcurementService {
    private vendors;
    private qualifications;
    private requests;
    private contracts;
    private licenses;
    private renewals;
    registerVendor(vendor: Vendor): Promise<Vendor>;
    getVendor(organizationId: string, vendorId: string): Promise<Vendor | undefined>;
    qualifyVendor(qualification: VendorQualification): Promise<VendorQualification>;
    isVendorQualifiedFor(organizationId: string, vendorId: string, scope: string): Promise<boolean>;
    submitRequest(request: ProcurementRequest): Promise<ProcurementRequest>;
    approveRequest(organizationId: string, requestId: string): Promise<ProcurementRequest>;
    addContract(contract: ContractRecord): Promise<ContractRecord>;
    getContract(organizationId: string, contractId: string, requestorHasPermission: boolean): Promise<ContractRecord>;
    addLicense(license: SoftwareLicense): Promise<SoftwareLicense>;
    assignLicense(organizationId: string, licenseId: string, count: number): Promise<SoftwareLicense>;
    getLicenseUtilization(organizationId: string, licenseId: string): Promise<{
        assigned: number;
        used: "UNKNOWN";
    }>;
    createRenewalCase(renewal: RenewalCase): Promise<RenewalCase>;
    generateRenewalRecommendation(organizationId: string, renewalId: string): Promise<RenewalCase>;
}
