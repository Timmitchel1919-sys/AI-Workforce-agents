/**
 * AI Workforce — Security Alert Publisher & Notification Seam (Step 25, 26)
 *
 * Provides a decoupled abstraction for dispatching security alert and incident
 * notifications to channels (in-app, email, WhatsApp, push) according to
 * deterministic severity policies without hardcoding third-party transport details.
 */
import type { NotificationEvent, SecurityAlertSeverity } from "../../contracts/security-center.js";

export interface SecurityAlertPublisher {
  publish(event: NotificationEvent): Promise<void>;
}

export function determineNotificationChannels(
  severity: SecurityAlertSeverity,
): readonly ("in-app" | "email" | "whatsapp" | "push")[] {
  switch (severity) {
    case "critical":
      return ["in-app", "email", "whatsapp", "push"];
    case "high":
      return ["in-app", "email"];
    case "medium":
    case "low":
    case "info":
    default:
      return ["in-app"];
  }
}

/**
 * In-memory notification publisher for local tests, audits, and decoupled worker queues.
 */
export class InMemoryAlertPublisher implements SecurityAlertPublisher {
  private readonly events: NotificationEvent[] = [];

  async publish(event: NotificationEvent): Promise<void> {
    this.events.push({ ...event });
  }

  getPublishedEvents(): readonly NotificationEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}
