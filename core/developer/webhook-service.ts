import { WebhookEndpoint, WebhookDelivery } from "../../contracts/api-platform.js";
import crypto from "crypto";

export class WebhookService {
  private endpoints = new Map<string, WebhookEndpoint>();
  private deliveries = new Map<string, WebhookDelivery>();

  createEndpoint(organizationId: string, url: string, description: string, events: string[]): WebhookEndpoint {
    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
    const endpoint: WebhookEndpoint = {
      endpointId: `ep_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      organizationId,
      url,
      description,
      events,
      secret,
      status: "ACTIVE",
      failureCount: 0,
      createdAt: new Date()
    };
    this.endpoints.set(endpoint.endpointId, endpoint);
    return endpoint;
  }

  listEndpoints(organizationId: string): WebhookEndpoint[] {
    return Array.from(this.endpoints.values()).filter(e => e.organizationId === organizationId);
  }

  generateSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac("sha256", secret);
    return `v1,${hmac.update(payload).digest("hex")}`;
  }

  // Simulates an outgoing dispatch and logs the delivery attempt
  async dispatchEvent(organizationId: string, eventId: string, eventType: string, payload: any) {
    const targets = this.listEndpoints(organizationId).filter(ep => 
      ep.status === "ACTIVE" && (ep.events.includes(eventType) || ep.events.includes("*"))
    );

    for (const ep of targets) {
      const payloadString = JSON.stringify(payload);
      const signature = this.generateSignature(payloadString, ep.secret);
      
      // Simulate network call
      const success = Math.random() > 0.1; // 10% failure chance for simulation

      const delivery: WebhookDelivery = {
        deliveryId: `del_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        endpointId: ep.endpointId,
        eventId,
        payload,
        status: success ? "SUCCESS" : "FAILED",
        statusCode: success ? 200 : 500,
        attempt: 1,
        deliveredAt: new Date()
      };

      this.deliveries.set(delivery.deliveryId, delivery);

      if (!success) {
        ep.failureCount++;
        if (ep.failureCount > 5) {
          ep.status = "FAILING";
        }
      } else {
        ep.failureCount = 0; // reset on success
      }
    }
  }

  getDeliveries(endpointId: string): WebhookDelivery[] {
    return Array.from(this.deliveries.values()).filter(d => d.endpointId === endpointId);
  }
}
