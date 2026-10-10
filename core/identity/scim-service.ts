import { ScimProvisioningEvent } from "../../contracts/identity.js";
import { SsoService } from "./sso-service.js";

interface ScimUserPayload {
  emails: readonly { value: string }[];
  name?: { givenName?: string; familyName?: string };
  roles?: string[];
}

function asScimUserPayload(payload: unknown): ScimUserPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as Record<string, unknown>;
  if (!Array.isArray(value.emails) || typeof value.emails[0] !== "object")
    return undefined;
  const email = value.emails[0] as Record<string, unknown>;
  return typeof email.value === "string"
    ? (value as unknown as ScimUserPayload)
    : undefined;
}

export class ScimService {
  private events: ScimProvisioningEvent[] = [];

  constructor(private ssoService: SsoService) {}

  handleProvisioningEvent(
    organizationId: string,
    action: ScimProvisioningEvent["action"],
    payload: Record<string, unknown>,
  ) {
    const event: ScimProvisioningEvent = {
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

  private processEvent(event: ScimProvisioningEvent) {
    try {
      const payload = asScimUserPayload(event.payload);
      if (!payload) throw new Error("invalid SCIM user payload");
      if (event.action === "USER_CREATED" || event.action === "USER_UPDATED") {
        this.ssoService.syncUserFromIdp(event.organizationId, "SCIM", {
          email: payload.emails[0].value,
          name: `${payload.name?.givenName ?? ""} ${payload.name?.familyName ?? ""}`.trim(),
          roles: payload.roles || ["USER"],
        });
      } else if (event.action === "USER_DELETED") {
        this.ssoService.suspendUserByEmail(payload.emails[0].value);
      }
      event.status = "PROCESSED";
    } catch {
      event.status = "FAILED";
    }
  }

  getEvents(organizationId: string): ScimProvisioningEvent[] {
    return this.events.filter((e) => e.organizationId === organizationId);
  }
}
