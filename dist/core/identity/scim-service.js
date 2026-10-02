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
            receivedAt: new Date()
        };
        this.events.push(event);
        this.processEvent(event);
    }
    processEvent(event) {
        try {
            if (event.action === "USER_CREATED" || event.action === "USER_UPDATED") {
                this.ssoService.syncUserFromIdp(event.organizationId, "SCIM", {
                    email: event.payload.emails[0].value,
                    name: `${event.payload.name.givenName} ${event.payload.name.familyName}`.trim(),
                    roles: event.payload.roles || ["USER"]
                });
            }
            else if (event.action === "USER_DELETED") {
                const user = Array.from(this.ssoService.users.values()).find((u) => u.email === event.payload.emails[0].value);
                if (user) {
                    user.status = "SUSPENDED";
                }
            }
            event.status = "PROCESSED";
        }
        catch (e) {
            event.status = "FAILED";
        }
    }
    getEvents(organizationId) {
        return this.events.filter(e => e.organizationId === organizationId);
    }
}
