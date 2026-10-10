interface CampaignRecord {
    campaignId: string;
    status: "DRAFT" | "ACTIVE";
    metrics: {
        conversions: number;
    };
}
interface LeadRecord {
    leadId: string;
    status: "NEW" | "QUALIFIED";
    score: number;
}
export declare class MarketingEngine {
    private readonly campaigns;
    private readonly leads;
    createCampaign(_org: string, _name: string, _budget: number, _tags: string[]): CampaignRecord;
    activateCampaign(cmp: string): void;
    recordLead(_org: string, _email: string, cmp: string): LeadRecord;
    qualifyLead(leadId: string): void;
}
export {};
