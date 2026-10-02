export interface Campaign {
    campaignId: string;
    organizationId: string;
    name: string;
    status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
    budget: number;
    spend: number;
    targetAudience: string[];
    startDate: Date;
    endDate?: Date;
    metrics: {
        impressions: number;
        clicks: number;
        conversions: number;
    };
}
export interface Lead {
    leadId: string;
    organizationId: string;
    email: string;
    score: number;
    status: "NEW" | "CONTACTED" | "QUALIFIED" | "LOST" | "CONVERTED";
    sourceCampaignId?: string;
    createdAt: Date;
    lastUpdated: Date;
}
