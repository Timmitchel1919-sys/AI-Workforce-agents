import { Campaign, Lead } from "../../contracts/marketing.js";
export declare class MarketingEngine {
    private campaigns;
    private leads;
    createCampaign(organizationId: string, name: string, budget: number, targetAudience: string[]): Campaign;
    activateCampaign(campaignId: string): void;
    recordLead(organizationId: string, email: string, sourceCampaignId?: string): Lead;
    qualifyLead(leadId: string): void;
    getCampaigns(organizationId: string): Campaign[];
    getLeads(organizationId: string): Lead[];
}
