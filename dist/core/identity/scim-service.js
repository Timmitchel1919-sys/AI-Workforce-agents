function asScimUserPayload(payload) {
    if (!payload || typeof payload !== "object")
        return undefined;
    const value = payload;
    if (!Array.isArray(value.emails) || typeof value.emails[0] !== "object")
        return undefined;
    const email = value.emails[0];
    return typeof email.value === "string"
        ? value
        : undefined;
}
export class ScimService {
    ssoService;
    events = [];
    constructor(ssoService) {
        this.ssoService = ssoService;
    }
    handleProvisioningEvent(organizationId, action, payload) {
        const event = {
            eventId: `scim_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            organizationId,
            action,
            payload,
            status: "PENDING",
            receivedAt: new Date(),
        };
        this.events.push(event);
        this.processEvent(event);
    }
    processEvent(event) {
        try {
            const payload = asScimUserPayload(event.payload);
            if (!payload)
                throw new Error("invalid SCIM user payload");
            if (event.action === "USER_CREATED" || event.action === "USER_UPDATED") {
                this.ssoService.syncUserFromIdp(event.organizationId, "SCIM", {
                    email: payload.emails[0].value,
                    name: `${payload.name?.givenName ?? ""} ${payload.name?.familyName ?? ""}`.trim(),
                    roles: payload.roles || ["USER"],
                });
            }
            else if (event.action === "USER_DELETED") {
                this.ssoService.suspendUserByEmail(payload.emails[0].value);
            }
            event.status = "PROCESSED";
        }
        catch {
            event.status = "FAILED";
        }
    }
    getEvents(organizationId) {
        return this.events.filter((e) => e.organizationId === organizationId);
    }
}
