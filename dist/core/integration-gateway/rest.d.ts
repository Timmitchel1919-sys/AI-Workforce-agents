/**
 * Declarative REST/GraphQL connector runtime.
 *
 * A connector manifest lists capabilities as HTTP templates. This runtime validates
 * the parameters, builds the request, injects the credential INSIDE `vault.use`, calls
 * the provider (host-pinned, no redirects, size- and time-bounded), classifies failures
 * and normalizes the response. Nothing else in the system builds provider requests.
 */
import { type CapabilityInfo, type FailureKind, type HealthSnapshot, type ParamSpec } from "../../contracts/integration-gateway.js";
import type { Secret } from "./vault.js";
export type FetchLike = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect?: "manual" | "follow";
}) => Promise<{
    ok: boolean;
    status: number;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
}>;
export interface RestHttp {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    /** Relative to the connector base URL; `{name}` is replaced by a (URL-encoded) parameter. */
    path: string;
    /** Absolute host override when the capability lives on another provider host. */
    baseUrl?: string;
    query?: string[];
    body?: string[] | "all";
    bodyStatic?: Record<string, unknown>;
    graphql?: {
        query: string;
        variables: string[];
    };
    /** Build the body from the parameters when a plain mapping is not enough. */
    build?: (params: Record<string, unknown>) => Record<string, unknown>;
}
export interface RestCapability extends CapabilityInfo {
    http?: RestHttp;
    /** Matches the resource identifier; named groups become path parameters. */
    resourcePattern?: RegExp;
    resourceHint?: string;
    /** Capability does not need a mapped external resource (still needs project access). */
    account?: boolean;
    /** Shape the provider JSON into the normalized result. */
    transform?: (json: unknown, params: Record<string, unknown>) => unknown;
    /** Providers that answer 200 with an error body (Slack, GraphQL). */
    bodyError?: (json: unknown) => {
        kind: FailureKind;
        message: string;
    } | undefined;
    /** Executed through a port instead of HTTP (deployment). */
    port?: "deployment";
}
export type AuthStyle = "bearer" | "basic" | "x-figma-token" | "none";
export interface ConnectorManifest {
    connectorId: string;
    provider: string;
    name: string;
    description: string;
    kind: "rest" | "graphql" | "environment";
    version: string;
    providerApiVersion: string;
    family: string;
    authMethod: "oauth2" | "api_key" | "token" | "basic" | "service_account" | "none";
    authStyle: AuthStyle;
    scopes: string[];
    oauth?: import("./vault.js").OAuthProviderConfig;
    /** Default credential reference (a server-side env var), never a value. */
    defaultCredentialRef?: string;
    baseUrl?: string;
    requiresBaseUrl?: boolean;
    allowedHosts: string[];
    defaultHeaders?: Record<string, string>;
    events: string[];
    environments: ("DEVELOPMENT" | "TEST" | "STAGING" | "PRODUCTION")[];
    costClass: "FREE" | "METERED";
    /** Health probe: a cheap READ capability. */
    probe?: string;
    capabilities: RestCapability[];
}
export interface RestOutcome {
    ok: boolean;
    status: number;
    data?: unknown;
    rateLimit?: HealthSnapshot["rateLimit"];
    failure?: {
        kind: FailureKind;
        message: string;
        retryAfterMs?: number;
    };
    durationMs: number;
}
export declare function validateParams(specs: readonly ParamSpec[], params: Record<string, unknown>): string | undefined;
export declare const pick: (fields: Record<string, string>) => (json: unknown) => unknown;
export declare const pickList: (listPath: string, fields: Record<string, string>) => (json: unknown) => unknown;
/** Bound depth, array length and string size, and mask anything credential-shaped. */
export declare function sanitize(value: unknown, depth?: number): unknown;
export declare function classifyStatus(status: number, headers: {
    get(name: string): string | null;
}): {
    kind: FailureKind;
    retryAfterMs?: number;
};
export interface RestCallInput {
    manifest: ConnectorManifest;
    cap: RestCapability;
    baseUrl: string;
    params: Record<string, unknown>;
    secret: Secret | undefined;
    fetchImpl: FetchLike;
    now: () => number;
}
export declare function hostAllowed(url: string, allowed: readonly string[]): boolean;
export declare function callRest(input: RestCallInput): Promise<RestOutcome>;
