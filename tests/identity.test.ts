import { test, assert } from "vitest";
import { SsoService, ScimService } from "../core/identity/index.js";

test("Identity: SSO Provider Registration and Resolution", () => {
  const service = new SsoService();
  
  service.registerProvider({
    providerId: "idp_okta_1",
    organizationId: "org_1",
    type: "SAML",
    name: "Acme Okta",
    status: "ACTIVE",
    configuration: { entryPoint: "https://acme.okta.com/sso" },
    domainMapping: ["acme.com", "acmecorp.com"],
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const provider = service.getProviderForDomain("acmecorp.com");
  assert.isDefined(provider);
  assert.equal(provider?.providerId, "idp_okta_1");

  assert.isUndefined(service.getProviderForDomain("globex.com"));

  assert.throws(() => {
    service.registerProvider({
      providerId: "idp_other",
      organizationId: "org_2",
      type: "OIDC",
      name: "Other",
      status: "ACTIVE",
      configuration: {},
      domainMapping: ["acme.com"], // Conflict
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }, "Domain acme.com is already mapped");
});

test("Identity: SCIM Provisioning and Session Management", () => {
  const ssoService = new SsoService();
  const scimService = new ScimService(ssoService);

  scimService.handleProvisioningEvent("org_1", "USER_CREATED", {
    emails: [{ value: "alice@acme.com" }],
    name: { givenName: "Alice", familyName: "Smith" },
    roles: ["ADMIN"]
  });

  // Verify user was synced
  const user = (Array.from((ssoService as any).users.values()) as any[]).find(u => u.email === "alice@acme.com");
  assert.isDefined(user);
  assert.equal(user.name, "Alice Smith");
  assert.include(user.roles, "ADMIN");
  assert.equal(user.status, "ACTIVE");

  // Create Session
  const session = ssoService.createSession(user.userId, "idp_okta_1", "192.168.1.1", "Mozilla");
  assert.isTrue(session.isValid);

  // Validate Session
  assert.isTrue(ssoService.validateSession(session.sessionId));

  // Revoke Session
  ssoService.revokeSession(session.sessionId);
  assert.isFalse(ssoService.validateSession(session.sessionId));

  // Delete via SCIM
  scimService.handleProvisioningEvent("org_1", "USER_DELETED", {
    emails: [{ value: "alice@acme.com" }]
  });

  const suspendedUser = ssoService.getUser(user.userId);
  assert.equal(suspendedUser?.status, "SUSPENDED");

  // Cannot create session for suspended user
  assert.throws(() => {
    ssoService.createSession(user.userId, "idp_okta_1", "192.168.1.1", "Mozilla");
  }, "User account is not active");
});
