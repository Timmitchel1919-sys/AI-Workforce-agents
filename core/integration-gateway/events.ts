/**
 * Integration event hub: signed webhooks in, normalized events out, filtered workflow triggers.
 *
 * A webhook is untrusted input. It is accepted only when its provider signature verifies
 * against a secret held in the vault (so an unsigned request, a forged one, or one for a
 * connector without a webhook secret is rejected), it is inside the replay window (where
 * the provider signs a timestamp), and its delivery id has not been seen. Payloads are
 * never stored — only a small normalized summary. Events start workflows only through an
 * explicit subscription (provider, event, project, resource, conditions), and a
 * triggered run is PROPOSED, never started behind the user's back.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Repository } from "../../contracts/persistence.js";
import {
  HUB_LIMITS,
  type EventSubscription,
  type HubEvent,
} from "../../contracts/integration-gateway.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
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
  }): Promise<{ runId?: string; note: string }>;
}

export interface NormalizedEvent {
  type: string;
  providerEvent: string;
  resource?: string;
  deliveryId: string;
  summary: Record<string, string | number | boolean>;
}

type Headers = Record<string, string | string[] | undefined>;
const h = (headers: Headers, name: string): string | undefined => {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const hmacHex = (secret: string, data: string): string =>
  createHmac("sha256", secret).update(data).digest("hex");

/* ---- provider-specific verification ---- */

export function verifyWebhook(
  provider: string,
  secret: string,
  headers: Headers,
  raw: string,
  nowMs: number,
): { ok: true } | { ok: false; reason: string } {
  switch (provider) {
    case "GitHub": {
      const sig = h(headers, "x-hub-signature-256");
      if (!sig?.startsWith("sha256="))
        return { ok: false, reason: "missing GitHub signature" };
      return safeEqual(sig.slice(7), hmacHex(secret, raw))
        ? { ok: true }
        : { ok: false, reason: "signature mismatch" };
    }
    case "Slack": {
      const ts = h(headers, "x-slack-request-timestamp");
      const sig = h(headers, "x-slack-signature");
      if (!ts || !sig || !/^\d+$/.test(ts))
        return { ok: false, reason: "missing Slack signature" };
      if (
        Math.abs(nowMs / 1000 - Number(ts)) >
        HUB_LIMITS.webhookReplayMs / 1000
      )
        return { ok: false, reason: "request is outside the replay window" };
      return sig.startsWith("v0=") &&
        safeEqual(sig.slice(3), hmacHex(secret, `v0:${ts}:${raw}`))
        ? { ok: true }
        : { ok: false, reason: "signature mismatch" };
    }
    case "Fireflies": {
      const sig = h(headers, "x-hub-signature");
      if (!sig?.startsWith("sha256="))
        return { ok: false, reason: "missing Fireflies signature" };
      return safeEqual(sig.slice(7), hmacHex(secret, raw))
        ? { ok: true }
        : { ok: false, reason: "signature mismatch" };
    }
    default: {
      const sig = h(headers, "x-signature");
      if (!sig) return { ok: false, reason: "missing signature" };
      const ts = h(headers, "x-timestamp");
      if (
        ts &&
        (!/^\d+$/.test(ts) ||
          Math.abs(nowMs / 1000 - Number(ts)) >
            HUB_LIMITS.webhookReplayMs / 1000)
      )
        return { ok: false, reason: "request is outside the replay window" };
      return safeEqual(sig, hmacHex(secret, ts ? `${ts}.${raw}` : raw))
        ? { ok: true }
        : { ok: false, reason: "signature mismatch" };
    }
  }
}

/* ---- normalization ---- */

export function normalizeEvent(
  provider: string,
  headers: Headers,
  body: Record<string, unknown>,
  raw: string,
): NormalizedEvent | { ignore: string } {
  const get = (o: unknown, path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (c, k) =>
          c && typeof c === "object"
            ? (c as Record<string, unknown>)[k]
            : undefined,
        o,
      );
  const str = (v: unknown, max = 100): string =>
    typeof v === "string"
      ? v.slice(0, max)
      : typeof v === "number"
        ? String(v)
        : "";
  if (provider === "GitHub") {
    const ev = h(headers, "x-github-event") ?? "";
    const deliveryId =
      h(headers, "x-github-delivery") ??
      createHash("sha256").update(raw).digest("hex").slice(0, 24);
    const resource = str(get(body, "repository.full_name"));
    switch (ev) {
      case "push":
        return {
          type: "repository.changed",
          providerEvent: "push",
          resource,
          deliveryId,
          summary: {
            branch: str(body["ref"]).replace(/^refs\/heads\//, ""),
            commits: Array.isArray(body["commits"])
              ? body["commits"].length
              : 0,
            pusher: str(get(body, "pusher.name")),
            head: str(body["after"]).slice(0, 8),
          },
        };
      case "pull_request":
        return {
          type: "pull_request.changed",
          providerEvent: "pull_request",
          resource,
          deliveryId,
          summary: {
            action: str(body["action"]),
            number: Number(get(body, "number") ?? 0),
            merged: Boolean(get(body, "pull_request.merged")),
          },
        };
      case "issues":
        return {
          type: "issue.changed",
          providerEvent: "issues",
          resource,
          deliveryId,
          summary: {
            action: str(body["action"]),
            number: Number(get(body, "issue.number") ?? 0),
          },
        };
      case "workflow_run":
        return {
          type: "ci.completed",
          providerEvent: "workflow_run",
          resource,
          deliveryId,
          summary: {
            conclusion: str(get(body, "workflow_run.conclusion")),
            name: str(get(body, "workflow_run.name")),
          },
        };
      default:
        return { ignore: `GitHub event "${ev || "unknown"}" is not handled` };
    }
  }
  if (provider === "Slack") {
    if (body["type"] === "url_verification")
      return { ignore: "url_verification" };
    const ev = get(body, "event") as Record<string, unknown> | undefined;
    if (body["type"] !== "event_callback" || !ev)
      return { ignore: "not an event callback" };
    if (ev["type"] === "message" && !ev["bot_id"] && !ev["subtype"])
      return {
        type: "message.received",
        providerEvent: "message",
        resource: str(ev["channel"]),
        deliveryId:
          str(body["event_id"]) ||
          createHash("sha256").update(raw).digest("hex").slice(0, 24),
        summary: {
          channel: str(ev["channel"]),
          user: str(ev["user"]),
          threaded: Boolean(ev["thread_ts"]),
          length: str(ev["text"], 100_000).length,
        },
      };
    return { ignore: `Slack event "${str(ev["type"])}" is not handled` };
  }
  if (provider === "Fireflies") {
    const type = str(body["eventType"]);
    if (/transcription completed/i.test(type))
      return {
        type: "meeting.completed",
        providerEvent: "transcription.completed",
        resource: "*",
        deliveryId: `${str(body["meetingId"])}:${type}`,
        summary: { meetingId: str(body["meetingId"]) },
      };
    return { ignore: `Fireflies event "${type}" is not handled` };
  }
  const t = str(body["type"]) || str(body["event"]);
  if (!t) return { ignore: "the payload names no event" };
  return {
    type: `${provider.toLowerCase()}.event`,
    providerEvent: t,
    resource: str(body["resource"]) || "*",
    deliveryId:
      str(body["id"]) ||
      createHash("sha256").update(raw).digest("hex").slice(0, 24),
    summary: { event: t },
  };
}

export interface EventRepos {
  events: Repository<HubEvent>;
  subscriptions: Repository<EventSubscription>;
  deliveries: Repository<HubWebhookDelivery>;
}

export class EventHub {
  private readonly events: Repository<HubEvent>;
  private readonly subs: Repository<EventSubscription>;
  private readonly deliveries: Repository<HubWebhookDelivery>;
  private readonly rejections: number[] = [];

  constructor(
    repos: EventRepos,
    private readonly registry: HubRegistry,
    private readonly vault: CredentialVault,
    private readonly ledger: GovernanceLedger,
    private readonly alerts: SecurityAlertService,
    private readonly trigger: EventTrigger | undefined,
    private readonly now: () => number,
  ) {
    this.events = new SyncCache(repos.events);
    this.subs = new SyncCache(repos.subscriptions);
    this.deliveries = new SyncCache(repos.deliveries);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  static webhookRef(connectorId: string): string {
    return CredentialVault.refFor(connectorId, "webhook");
  }

  private reject(
    connectorId: string,
    reason: string,
  ): { status: number; body: Record<string, unknown> } {
    this.ledger.record("webhook.rejected", {
      actor: "integration-hub",
      severity: "MEDIUM",
      result: "REJECTED",
      detail: { connectorId, reason },
    });
    const t = this.now();
    this.rejections.push(t);
    while (this.rejections.length > 0 && t - this.rejections[0]! > 10 * 60_000)
      this.rejections.shift();
    if (this.rejections.length >= 3)
      this.alerts.raise({
        severity: "HIGH",
        source: "INTEGRATION",
        event: "suspicious_webhooks",
        description: `${this.rejections.length} webhook deliveries were rejected in 10 minutes (possible spoofing or replay).`,
        evidence: { connectorId, last: reason },
        dedupeKey: `webhooks:${connectorId}`,
      });
    return {
      status:
        reason.includes("replay") || reason.includes("signature") ? 401 : 400,
      body: { error: "webhook rejected" },
    };
  }

  /** Handle one delivery. The response never reveals why a request was refused beyond the status. */
  async receive(
    connectorId: string,
    headers: Headers,
    raw: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const connector = this.registry.get(connectorId);
    if (!connector || !connector.enabled)
      return { status: 404, body: { error: "not found" } };
    if (raw.length > 256_000)
      return this.reject(connectorId, "payload too large");
    if (!this.vault.has(EventHub.webhookRef(connectorId)))
      return this.reject(
        connectorId,
        "signature: no webhook secret is configured for this connector",
      );
    const verdict = await this.vault.use(
      EventHub.webhookRef(connectorId),
      "webhook.verify",
      (s) =>
        verifyWebhook(connector.provider, s.reveal(), headers, raw, this.now()),
    );
    if (!verdict.ok)
      return this.reject(connectorId, `signature: ${verdict.reason}`);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      )
        throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return this.reject(connectorId, "malformed payload");
    }
    if (connector.provider === "Slack" && body["type"] === "url_verification")
      return {
        status: 200,
        body: { challenge: String(body["challenge"] ?? "") },
      };

    const norm = normalizeEvent(connector.provider, headers, body, raw);
    if ("ignore" in norm) return { status: 200, body: { ignored: true } };
    const deliveryKey = `${connectorId}:${norm.deliveryId}`;
    if (this.deliveries.findById(deliveryKey))
      return { status: 200, body: { duplicate: true } };
    this.deliveries.upsert({ id: deliveryKey, at: this.iso() });
    const old = this.deliveries.list();
    if (old.length > 5000)
      for (const d of old
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(0, old.length - 5000))
        this.deliveries.delete(d.id);

    const owners = this.registry
      .mappings_()
      .filter(
        (m) =>
          m.connectorId === connectorId &&
          m.status === "ACTIVE" &&
          (m.resource === norm.resource || m.resource === "*"),
      );
    const projectIds = [...new Set(owners.map((m) => m.projectId))];
    const triggered: string[] = [];
    const eventId = `evt-${randomBytes(5).toString("hex")}`;
    let event: HubEvent = {
      id: eventId,
      eventId,
      provider: connector.provider,
      connectorId,
      ...(projectIds[0] ? { projectId: projectIds[0] } : {}),
      type: norm.type,
      providerEvent: norm.providerEvent,
      ...(norm.resource ? { resource: maskSecrets(norm.resource) } : {}),
      deliveryId: norm.deliveryId,
      receivedAt: this.iso(),
      status: projectIds.length === 0 ? "IGNORED" : "RECEIVED",
      ...(projectIds.length === 0
        ? { reason: "no project is mapped to this resource" }
        : {}),
      summary: norm.summary,
      triggered,
    };
    this.events.upsert(event);
    this.ledger.record("webhook.received", {
      actor: "integration-hub",
      projectId: projectIds[0],
      result: event.status,
      detail: { connectorId, type: norm.type },
    });

    for (const projectId of projectIds) {
      for (const sub of this.subs.list()) {
        if (
          !sub.enabled ||
          sub.provider !== connector.provider ||
          sub.eventType !== norm.type ||
          sub.projectId !== projectId
        )
          continue;
        if (
          sub.resourcePattern &&
          !(norm.resource ?? "").includes(sub.resourcePattern)
        )
          continue;
        if (!sub.conditions.every((c) => norm.summary[c.field] === c.equals))
          continue;
        if (!this.trigger) continue;
        try {
          const r = await this.trigger.propose({
            subscription: sub,
            event: { ...event, projectId },
          });
          triggered.push(r.runId ?? sub.subscriptionId);
          this.subs.upsert({
            ...sub,
            fires: sub.fires + 1,
            lastFiredAt: this.iso(),
          });
        } catch {
          event = {
            ...event,
            status: "FAILED",
            reason: "a subscription could not start its workflow",
          };
        }
      }
    }
    if (triggered.length > 0 && event.status !== "FAILED")
      event = { ...event, status: "TRIGGERED", triggered };
    this.events.upsert(event);
    return {
      status: 202,
      body: {
        accepted: true,
        eventId,
        type: norm.type,
        triggered: triggered.length,
      },
    };
  }

  /* ---- queries & subscriptions ---- */

  list(
    filter: {
      provider?: string;
      projectId?: string;
      type?: string;
      status?: string;
      since?: string;
      limit?: number;
    } = {},
  ): HubEvent[] {
    return this.events
      .list()
      .filter((e) => !filter.provider || e.provider === filter.provider)
      .filter((e) => !filter.projectId || e.projectId === filter.projectId)
      .filter((e) => !filter.type || e.type === filter.type)
      .filter((e) => !filter.status || e.status === filter.status)
      .filter((e) => !filter.since || e.receivedAt >= filter.since)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, Math.min(filter.limit ?? 100, 500));
  }

  subscriptions(): EventSubscription[] {
    return this.subs.list();
  }

  subscribe(input: {
    name: string;
    provider: string;
    eventType: string;
    projectId: string;
    resourcePattern?: string;
    conditions?: EventSubscription["conditions"];
    request: string;
    by: string;
  }): EventSubscription {
    if (!input.provider || !input.eventType || !input.projectId)
      throw new Error(
        "provider, event and project are required: workflows are never triggered by every external event",
      );
    if (!input.request.trim() || input.request.length > 600)
      throw new Error(
        "the workflow request text is required (max 600 characters)",
      );
    const subscriptionId = `sub-${randomBytes(4).toString("hex")}`;
    const sub: EventSubscription = {
      id: subscriptionId,
      subscriptionId,
      name: input.name.slice(0, 80),
      provider: input.provider,
      eventType: input.eventType,
      projectId: input.projectId,
      ...(input.resourcePattern
        ? { resourcePattern: input.resourcePattern.slice(0, 120) }
        : {}),
      conditions: (input.conditions ?? []).slice(0, 8),
      action: { kind: "propose_run", request: input.request.trim() },
      enabled: true,
      createdBy: input.by,
      createdAt: this.iso(),
      fires: 0,
    };
    this.subs.upsert(sub);
    return sub;
  }

  setEnabled(
    subscriptionId: string,
    enabled: boolean,
  ): EventSubscription | undefined {
    const s = this.subs.findById(subscriptionId);
    if (!s) return undefined;
    const next = { ...s, enabled };
    this.subs.upsert(next);
    return next;
  }
}
