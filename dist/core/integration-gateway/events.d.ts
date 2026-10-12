import type { Repository } from "../../contracts/persistence.js";
import { type EventSubscription, type HubEvent } from "../../contracts/integration-gateway.js";
import type { SecurityAlertService } from "../security-governance/alerts.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";
import { CredentialVault } from "./vault.js";
import type { HubRegistry } from "./registry.js";
export interface HubWebhookDelivery {
    id: string;
    at: string;
}
export interface EventTrigger {
    /** Prepare a workflow run for the user; returns its id when one was created. */
    propose(input: {
        subscription: EventSubscription;
        event: HubEvent;
    }): Promise<{
        runId?: string;
        note: string;
    }>;
}
export interface NormalizedEvent {
    type: string;
    providerEvent: string;
    resource?: string;
    deliveryId: string;
    summary: Record<string, string | number | boolean>;
}
type Headers = Record<string, string | string[] | undefined>;
export declare function verifyWebhook(provider: string, secret: string, headers: Headers, raw: string, nowMs: number): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare function normalizeEvent(provider: string, headers: Headers, body: Record<string, unknown>, raw: string): NormalizedEvent | {
    ignore: string;
};
export interface EventRepos {
    events: Repository<HubEvent>;
    subscriptions: Repository<EventSubscription>;
    deliveries: Repository<HubWebhookDelivery>;
}
export declare class EventHub {
    private readonly registry;
    private readonly vault;
    private readonly ledger;
    private readonly alerts;
    private readonly trigger;
    private readonly now;
    private readonly events;
    private readonly subs;
    private readonly deliveries;
    private readonly rejections;
    constructor(repos: EventRepos, registry: HubRegistry, vault: CredentialVault, ledger: GovernanceLedger, alerts: SecurityAlertService, trigger: EventTrigger | undefined, now: () => number);
    private iso;
    static webhookRef(connectorId: string): string;
    private reject;
    /** Handle one delivery. The response never reveals why a request was refused beyond the status. */
    receive(connectorId: string, headers: Headers, raw: string): Promise<{
        status: number;
        body: Record<string, unknown>;
    }>;
    list(filter?: {
        provider?: string;
        projectId?: string;
        type?: string;
        status?: string;
        since?: string;
        limit?: number;
    }): HubEvent[];
    subscriptions(): EventSubscription[];
    subscribe(input: {
        name: string;
        provider: string;
        eventType: string;
        projectId: string;
        resourcePattern?: string;
        conditions?: EventSubscription["conditions"];
        request: string;
        by: string;
    }): EventSubscription;
    setEnabled(subscriptionId: string, enabled: boolean): EventSubscription | undefined;
}
export {};
