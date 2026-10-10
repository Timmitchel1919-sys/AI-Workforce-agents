/**
 * Infrastructure (read-only): environment types, detected environment
 * instances, registered hosts and the tool registry. Same-origin Control
 * Plane only — the backend authorizes, scopes and serves only safe metadata.
 * Nothing here is simulated: an empty registry is shown as empty.
 */
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";

export type Availability = "available" | "unavailable" | "degraded" | "disabled";
export type TrustLevel = "declared" | "detected" | "verified";

/** contracts/environments.ts `VersionInfo`. */
export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
  preRelease?: string;
  build?: string;
}

export interface CapabilityDeclaration {
  capability: string;
  available: boolean;
  evidence?: string;
  detail?: string;
}

export interface ToolchainDescriptor {
  kind: string;
  name: string;
  version?: VersionInfo;
}

export interface ToolchainRequirement {
  kind: string;
  minimum?: VersionInfo;
  components?: readonly { name: string; minimum?: VersionInfo }[];
}

/** `GET /api/environments/descriptors` — supported environment types. */
export interface EnvironmentDescriptor {
  id: string;
  name: string;
  description: string;
  environmentType: string;
  supportedToolchains: readonly ToolchainRequirement[];
  requiredCapabilities: readonly string[];
  declaredCapabilities?: readonly string[];
  minimumOs?: { os?: string; architecture?: string };
}

/** `GET /api/environments/instances` — detected, registered installations. */
export interface EnvironmentInstance {
  id: string;
  descriptorId: string;
  hostId: string;
  environmentType: string;
  name: string;
  version?: VersionInfo;
  availability: Availability;
  capabilities: readonly CapabilityDeclaration[];
  toolchains: readonly ToolchainDescriptor[];
  trustLevel: TrustLevel;
  lastDetectedAt?: string;
  lastVerifiedAt?: string;
}

/** `GET /api/hosts` — registered machines. */
export interface HostInstance {
  id: string;
  hostId: string;
  name: string;
  hostType: string;
  os: { os: string; version?: string; architecture: string };
  trustLevel: TrustLevel;
  availability: Availability;
  capabilities: readonly CapabilityDeclaration[];
  lastDetectedAt?: string;
  lastVerifiedAt?: string;
  lastHealthCheckAt?: string;
}

/** `GET /api/tools` (contracts/control.ts `ToolView`). */
export interface ToolItem {
  toolId: string;
  name: string;
  version: string;
  capabilities: readonly string[];
  allowedAgents: readonly string[];
  allowedProjects: readonly string[];
  allowedEnvironments: readonly string[];
  requiredPermission: string;
  approvalRequired: boolean;
  stats: {
    total: number;
    completed: number;
    failed: number;
    denied: number;
    timedOut: number;
    approvalRequired: number;
  };
}

export type InfrastructureFailure = "unauthenticated" | "forbidden" | "unavailable";

export class InfrastructureError extends Error {
  readonly failure: InfrastructureFailure;
  constructor(failure: InfrastructureFailure, message: string) {
    super(message);
    this.name = "InfrastructureError";
    this.failure = failure;
  }
}

async function get<T>(path: string, token?: string | null): Promise<T> {
  try {
    return await apiRequest<T>(path, { method: "GET", accessToken: token });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      throw new InfrastructureError(error.status === 401 ? "unauthenticated" : "forbidden", error.message);
    }
    throw new InfrastructureError("unavailable", "Control Plane unreachable");
  }
}

export const getEnvironmentDescriptors = (token?: string | null) =>
  get<EnvironmentDescriptor[]>("/api/environments/descriptors", token);
export const getEnvironmentInstances = (token?: string | null) =>
  get<EnvironmentInstance[]>("/api/environments/instances", token);
export const getHosts = (token?: string | null) => get<HostInstance[]>("/api/hosts", token);
export const getTools = (token?: string | null) => get<ToolItem[]>("/api/tools", token);

/** `20.11.1`, with optional pre-release/build (mirrors contracts `formatVersion`). */
export function formatVersion(version: VersionInfo | undefined): string | undefined {
  if (!version) return undefined;
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return `${base}${version.preRelease ? `-${version.preRelease}` : ""}${version.build ? `+${version.build}` : ""}`;
}
