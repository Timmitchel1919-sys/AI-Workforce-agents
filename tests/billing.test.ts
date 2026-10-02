import test from "node:test";

import { assert } from "./helpers/assert.js";
import { 
  CatalogService, 
  EntitlementService, 
  RatingEngine, 
  InvoiceService, 
  TestPaymentAdapter, 
  WebhookHandler, 
  SubscriptionService, 
  DunningService 
} from "../core/billing/index.js";
import { 
  CommercialProduct, 
  CommercialPlan, 
  PlanVersion, 
  Price,
  Subscription
} from "../contracts/billing.js";

test("Billing: Catalog resolution", () => {
  const catalog = new CatalogService();
  catalog.registerProduct({ productId: "prod_1", name: "AI Workforce", description: "", status: "ACTIVE" });
  catalog.registerPlan({ planId: "plan_free", productId: "prod_1", activeVersionId: "v1_free" });
  catalog.registerPlanVersion({ 
    versionId: "v1_free", 
    planId: "plan_free", 
    version: 1, 
    displayName: "Free Plan", 
    status: "ACTIVE",
    billingCadence: "MONTHLY",
    entitlements: { "projects.max": 2 },
    priceReferences: ["price_free_1"],
    trialEligibility: false
  });
  catalog.registerPrice({
    priceId: "price_free_1",
    planVersionId: "v1_free",
    currency: "USD",
    version: 1,
    components: [{ mode: "FIXED_RECURRING", amountMinorUnits: 0, currency: "USD" }]
  });

  const version = catalog.resolveEffectivePlanVersion("plan_free");
  assert.isDefined(version);
  assert.equal(version?.versionId, "v1_free");

  const prices = catalog.resolvePriceForVersion("v1_free");
  assert.equal(prices.length, 1);
  assert.equal(prices[0].priceId, "price_free_1");
});

test("Billing: Entitlement resolution (Quota vs Boolean)", () => {
  const catalog = new CatalogService();
  catalog.registerPlanVersion({ 
    versionId: "v1_pro", 
    planId: "plan_pro", 
    version: 1, 
    displayName: "Pro Plan", 
    status: "ACTIVE",
    billingCadence: "MONTHLY",
    entitlements: { "projects.max": 10, "customAgents.enabled": true },
    priceReferences: [],
    trialEligibility: false
  });

  const entitlementService = new EntitlementService(catalog);
  entitlementService.registerEntitlementDefinition({ entitlementId: "projects.max", name: "Max Projects", type: "QUOTA" });
  entitlementService.registerEntitlementDefinition({ entitlementId: "customAgents.enabled", name: "Custom Agents", type: "BOOLEAN" });

  const sub: Subscription = {
    subscriptionId: "sub_1",
    organizationId: "org_1",
    billingAccountId: "ba_1",
    productId: "prod_1",
    planId: "plan_pro",
    planVersionId: "v1_pro",
    status: "ACTIVE",
    billingCadence: "MONTHLY",
    currency: "USD",
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    cancelAtPeriodEnd: false
  };

  // Check valid quota
  let result = entitlementService.checkFeatureAccess("org_1", "projects.max", sub, 5);
  assert.isTrue(result.allowed);
  assert.equal(result.reason, "ENTITLED");

  // Check quota exceeded
  result = entitlementService.checkFeatureAccess("org_1", "projects.max", sub, 15);
  assert.isFalse(result.allowed);
  assert.equal(result.reason, "QUOTA_EXCEEDED");

  // Check boolean feature
  result = entitlementService.checkFeatureAccess("org_1", "customAgents.enabled", sub);
  assert.isTrue(result.allowed);
});

test("Billing: Entitlement Enterprise Override", () => {
  const catalog = new CatalogService();
  catalog.registerPlanVersion({ 
    versionId: "v1_pro", 
    planId: "plan_pro", 
    version: 1, 
    displayName: "Pro Plan", 
    status: "ACTIVE",
    billingCadence: "MONTHLY",
    entitlements: { "projects.max": 10 },
    priceReferences: [],
    trialEligibility: false
  });

  const entitlementService = new EntitlementService(catalog);
  entitlementService.registerEntitlementDefinition({ entitlementId: "projects.max", name: "Max Projects", type: "QUOTA" });

  entitlementService.setContractOverride({
    organizationId: "org_1",
    planId: "plan_pro",
    customQuotas: { "projects.max": 50 },
    contractStart: new Date(Date.now() - 10000),
    contractEnd: new Date(Date.now() + 100000)
  });

  const sub: Subscription = {
    subscriptionId: "sub_1",
    organizationId: "org_1",
    billingAccountId: "ba_1",
    productId: "prod_1",
    planId: "plan_pro",
    planVersionId: "v1_pro",
    status: "ACTIVE",
    billingCadence: "MONTHLY",
    currency: "USD",
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    cancelAtPeriodEnd: false
  };

  // Even though base limit is 10, override is 50. Usage of 20 should be allowed.
  let result = entitlementService.checkFeatureAccess("org_1", "projects.max", sub, 20);
  assert.isTrue(result.allowed);
  assert.equal(result.reason, "CONTRACT_OVERRIDE");
  assert.equal(result.limit, 50);
});

test("Billing: Rating Engine", () => {
  const engine = new RatingEngine();
  const price: Price = {
    priceId: "price_1",
    planVersionId: "v1",
    currency: "USD",
    version: 1,
    components: [
      { mode: "PER_UNIT", amountMinorUnits: 15, currency: "USD", meterId: "execution.minutes" }
    ]
  };

  const charges = engine.rateUsage("sub_1", {
    organizationId: "org_1",
    meterId: "execution.minutes",
    periodStart: new Date(),
    periodEnd: new Date(),
    observedUsage: 100,
    includedUsage: 0,
    billableUsage: 100
  }, price);

  assert.equal(charges.length, 1);
  assert.equal(charges[0].amountMinorUnits, 1500); // 100 * 15 cents
});

test("Billing: Rating Engine Tiered Pricing", () => {
  const engine = new RatingEngine();
  const price: Price = {
    priceId: "price_2",
    planVersionId: "v2",
    currency: "USD",
    version: 1,
    components: [
      { 
        mode: "TIERED", 
        amountMinorUnits: 0, 
        currency: "USD", 
        meterId: "api.calls",
        tierBoundaries: [
          { upTo: 1000, amountMinorUnits: 1 }, // 1 cent per call up to 1000
          { upTo: null, amountMinorUnits: 0.5 } // 0.5 cents per call after 1000
        ]
      }
    ]
  };

  const charges = engine.rateUsage("sub_1", {
    organizationId: "org_1",
    meterId: "api.calls",
    periodStart: new Date(),
    periodEnd: new Date(),
    observedUsage: 1500,
    includedUsage: 0,
    billableUsage: 1500
  }, price);

  // Should generate 2 charges: 1000 calls at 1c, 500 calls at 0.5c
  assert.equal(charges.length, 2);
  assert.equal(charges[0].amountMinorUnits, 1000);
  assert.equal(charges[1].amountMinorUnits, 250);
});

test("Billing: Invoice Service", () => {
  const invoiceService = new InvoiceService();
  const invoice = invoiceService.createDraftInvoice("org_1", "ba_1", "sub_1", "USD", new Date(), new Date());

  invoiceService.addChargeToInvoice(invoice.invoiceId, {
    subscriptionId: "sub_1",
    description: "Base plan",
    quantity: 1,
    unit: "month",
    unitPriceMinorUnits: 5000,
    amountMinorUnits: 5000,
    currency: "USD",
    periodStart: new Date(),
    periodEnd: new Date()
  }, "SUBSCRIPTION_BASE");

  invoiceService.addAdjustment(invoice.invoiceId, 1000, "Loyalty Discount", true); // Credit of $10

  const finalized = invoiceService.finalizeInvoice(invoice.invoiceId);
  
  assert.equal(finalized.status, "OPEN");
  assert.equal(finalized.subtotalMinorUnits, 5000);
  assert.equal(finalized.creditTotalMinorUnits, 1000);
  assert.equal(finalized.totalMinorUnits, 4000);
  assert.equal(finalized.amountDueMinorUnits, 4000);

  invoiceService.markInvoicePaid(invoice.invoiceId, 4000);
  assert.equal(finalized.status, "PAID");
});

test("Billing: Webhook Idempotency & Signature", () => {
  const adapter = new TestPaymentAdapter();
  const webhookHandler = new WebhookHandler(adapter);

  const payload = JSON.stringify({ some: "data" });
  
  // Test invalid signature
  assert.throws(() => {
    webhookHandler.handleWebhook(payload, "invalid_sig", {
      eventId: "evt_1",
      provider: "TEST",
      eventType: "payment.succeeded",
      receivedAt: new Date(),
      status: "PENDING",
      resourceRefs: [],
      payloadDigest: "xyz"
    });
  }, "Invalid webhook signature");

  // Test valid signature & idempotency
  const event = {
    eventId: "evt_1",
    provider: "TEST",
    eventType: "payment.succeeded",
    receivedAt: new Date(),
    status: "PENDING",
    resourceRefs: [],
    payloadDigest: "xyz"
  } as any;

  // First time success
  const res1 = webhookHandler.handleWebhook(payload, "test_valid_sig", event);
  assert.isTrue(res1);

  // Second time idempotent (no throw)
  const res2 = webhookHandler.handleWebhook(payload, "test_valid_sig", event);
  assert.isTrue(res2);
});

test("Billing: Dunning and Restrictions", () => {
  const subService = new SubscriptionService();
  const catalog = new CatalogService();
  const entService = new EntitlementService(catalog);
  const dunning = new DunningService(subService, entService);

  subService.createSubscription({
    subscriptionId: "sub_1",
    organizationId: "org_1",
    billingAccountId: "ba_1",
    productId: "prod_1",
    planId: "plan_1",
    planVersionId: "v1",
    status: "ACTIVE",
    billingCadence: "MONTHLY",
    currency: "USD",
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    cancelAtPeriodEnd: false
  });

  // Handle failure with no grace period
  dunning.handlePaymentFailure("org_1", "sub_1", 0);
  
  const sub = subService.getSubscription("sub_1");
  assert.equal(sub?.status, "RESTRICTED");

  // Check feature access is blocked by payment restriction
  const result = entService.checkFeatureAccess("org_1", "premium_agents", sub);
  assert.isFalse(result.allowed);
  assert.equal(result.reason, "PAYMENT_RESTRICTION");

  // Handle recovery
  dunning.handlePaymentRecovery("org_1", "sub_1");
  assert.equal(sub?.status, "ACTIVE");
});

