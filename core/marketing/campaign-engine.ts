import { Campaign, Lead } from "../../contracts/marketing.js";

export class MarketingEngine {
  private campaigns = new Map<string, Campaign>();
  private leads = new Map<string, Lead>();

  createCampaign(organizationId: string, name: string, budget: number, targetAudience: string[]): Campaign {
    const campaign: Campaign = {
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

  activateCampaign(campaignId: string) {
    const campaign = this.campaigns.get(campaignId);
    if (campaign) {
      campaign.status = "ACTIVE";
    }
  }

  recordLead(organizationId: string, email: string, sourceCampaignId?: string): Lead {
    const lead: Lead = {
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
      if (cmp) cmp.metrics.conversions++;
    }

    this.leads.set(lead.leadId, lead);
    return lead;
  }

  qualifyLead(leadId: string) {
    const lead = this.leads.get(leadId);
    if (lead) {
      lead.score += 25;
      if (lead.score >= 75) lead.status = "QUALIFIED";
      lead.lastUpdated = new Date();
    }
  }

  getCampaigns(organizationId: string): Campaign[] {
    return Array.from(this.campaigns.values()).filter(c => c.organizationId === organizationId);
  }

  getLeads(organizationId: string): Lead[] {
    return Array.from(this.leads.values()).filter(l => l.organizationId === organizationId);
  }
}
