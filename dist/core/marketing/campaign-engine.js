export class MarketingEngine {
    campaigns = new Map();
    leads = new Map();
    createCampaign(organizationId, name, budget, targetAudience) {
        const campaign = {
            campaignId: `cmp_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            organizationId,
            name,
            status: "DRAFT",
            budget,
            spend: 0,
            targetAudience,
            startDate: new Date(),
            metrics: { impressions: 0, clicks: 0, conversions: 0 }
        };
        this.campaigns.set(campaign.campaignId, campaign);
        return campaign;
    }
    activateCampaign(campaignId) {
        const campaign = this.campaigns.get(campaignId);
        if (campaign) {
            campaign.status = "ACTIVE";
        }
    }
    recordLead(organizationId, email, sourceCampaignId) {
        const lead = {
            leadId: `ld_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            organizationId,
            email,
            score: 50,
            status: "NEW",
            sourceCampaignId,
            createdAt: new Date(),
            lastUpdated: new Date()
        };
        if (sourceCampaignId) {
            const cmp = this.campaigns.get(sourceCampaignId);
            if (cmp)
                cmp.metrics.conversions++;
        }
        this.leads.set(lead.leadId, lead);
        return lead;
    }
    qualifyLead(leadId) {
        const lead = this.leads.get(leadId);
        if (lead) {
            lead.score += 25;
            if (lead.score >= 75)
                lead.status = "QUALIFIED";
            lead.lastUpdated = new Date();
        }
    }
    getCampaigns(organizationId) {
        return Array.from(this.campaigns.values()).filter(c => c.organizationId === organizationId);
    }
    getLeads(organizationId) {
        return Array.from(this.leads.values()).filter(l => l.organizationId === organizationId);
    }
}
