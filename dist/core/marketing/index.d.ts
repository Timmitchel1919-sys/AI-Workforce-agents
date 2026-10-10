export declare class MarketingEngine {
    createCampaign(org: string, name: string, budget: number, tags: string[]): any;
    activateCampaign(cmp: string): void;
    recordLead(org: string, email: string, cmp: string): any;
    qualifyLead(lead: string): void;
}
