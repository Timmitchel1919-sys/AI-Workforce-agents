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
export declare function determineNotificationChannels(severity: SecurityAlertSeverity): readonly ("in-app" | "email" | "whatsapp" | "push")[];
/**
 * In-memory notification publisher for local tests, audits, and decoupled worker queues.
 */
export declare class InMemoryAlertPublisher implements SecurityAlertPublisher {
    private readonly events;
    publish(event: NotificationEvent): Promise<void>;
    getPublishedEvents(): readonly NotificationEvent[];
    clear(): void;
}
