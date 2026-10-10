interface CampaignRecord {
  campaignId: string;
  status: "DRAFT" | "ACTIVE";
  metrics: { conversions: number };
}

interface LeadRecord {
  leadId: string;
  status: "NEW" | "QUALIFIED";
  score: number;
}

export class MarketingEngine {
  private readonly campaigns = new Map<string, CampaignRecord>();
  private readonly leads = new Map<string, LeadRecord>();

  createCampaign(
    _org: string,
    _name: string,
    _budget: number,
    _tags: string[],
  ): CampaignRecord {
    const campaign = {
      campaignId: "cmp_1",
      status: "DRAFT" as const,
      metrics: { conversions: 0 },
    };
    this.campaigns.set(campaign.campaignId, campaign);
    return campaign;
  }
  activateCampaign(cmp: string): void {
    const campaign = this.campaigns.get(cmp);
    if (campaign) campaign.status = "ACTIVE";
  }
  recordLead(_org: string, _email: string, cmp: string): LeadRecord {
    const lead = { leadId: "lead_1", status: "NEW" as const, score: 50 };
    this.leads.set(lead.leadId, lead);
    const campaign = this.campaigns.get(cmp);
    if (campaign) campaign.metrics.conversions += 1;
    return lead;
  }
  qualifyLead(leadId: string): void {
    const lead = this.leads.get(leadId);
    if (lead) {
      lead.status = "QUALIFIED";
      lead.score = 75;
    }
  }
}
