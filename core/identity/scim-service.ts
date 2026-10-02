import { ScimProvisioningEvent } from "../../contracts/identity.js";
import { SsoService } from "./sso-service.js";

export class ScimService {
  private events: ScimProvisioningEvent[] = [];

  constructor(private ssoService: SsoService) {}

  handleProvisioningEvent(organizationId: string, action: ScimProvisioningEvent["action"], payload: any) {
    const event: ScimProvisioningEvent = {
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

  private processEvent(event: ScimProvisioningEvent) {
    try {
      if (event.action === "USER_CREATED" || event.action === "USER_UPDATED") {
        this.ssoService.syncUserFromIdp(event.organizationId, "SCIM", {
          email: event.payload.emails[0].value,
          name: `${event.payload.name.givenName} ${event.payload.name.familyName}`.trim(),
          roles: event.payload.roles || ["USER"]
        });
      } else if (event.action === "USER_DELETED") {
        const user = Array.from((this.ssoService as any).users.values()).find((u: any) => u.email === event.payload.emails[0].value);
        if (user) {
          (user as any).status = "SUSPENDED";
        }
      }
      event.status = "PROCESSED";
    } catch (e) {
      event.status = "FAILED";
    }
  }

  getEvents(organizationId: string): ScimProvisioningEvent[] {
    return this.events.filter(e => e.organizationId === organizationId);
  }
}

