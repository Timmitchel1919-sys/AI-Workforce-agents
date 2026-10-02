import test from "node:test";

import { assert } from "./helpers/assert.js";
import { MarketingEngine } from "../core/marketing/index.js";

test("Marketing: Campaign and Lead tracking", () => {
  const engine = new MarketingEngine();
  
  const cmp = engine.createCampaign("org_1", "Q4 Launch", 5000, ["Enterprise", "SaaS"]);
  assert.equal(cmp.status, "DRAFT");
  
  engine.activateCampaign(cmp.campaignId);
  assert.equal(cmp.status, "ACTIVE");

  const lead = engine.recordLead("org_1", "ceo@acme.com", cmp.campaignId);
  assert.equal(lead.status, "NEW");
  assert.equal(lead.score, 50);

  // Campaign metrics updated
  assert.equal(cmp.metrics.conversions, 1);

  // Qualify lead
  engine.qualifyLead(lead.leadId);
  assert.equal(lead.status, "QUALIFIED");
  assert.equal(lead.score, 75);
});
