import { Entity } from "./persistence.js";

export const ASSET_CATEGORIES = [
  "HARDWARE",
  "SOFTWARE",
  "CLOUD_RESOURCE",
  "AI_MODEL",
  "AI_AGENT",
  "NETWORK",
  "DATA",
  "PERIPHERAL"
] as const;
export type AssetCategory = typeof ASSET_CATEGORIES[number];

export const ASSET_STATES = [
  "REQUESTED",
  "PROCURED",
  "IN_STOCK",
  "DEPLOYED",
  "IN_MAINTENANCE",
  "DEPRECATED",
  "RETIRED",
  "DISPOSED",
  "LOST"
] as const;
export type AssetState = typeof ASSET_STATES[number];

export interface EnterpriseAsset extends Entity {
  assetId: string;
  organizationId: string;
  name: string;
  category: AssetCategory;
  status: AssetState;
  ownerRef?: string;
  custodianRef?: string;
  vendorId?: string;
  procurementRef?: string;
  contractRef?: string;
  location?: string;
  costMinorUnits?: number;
  currency?: string;
  acquiredAt?: string;
  warrantyExpiration?: string;
  supportExpiration?: string;
  endOfLife?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetLifecycleEvent extends Entity {
  eventId: string;
  organizationId: string;
  assetId: string;
  eventType: "PROVISIONED" | "ASSIGNED" | "MAINTENANCE_PERFORMED" | "STATUS_CHANGED" | "DISPOSED";
  actorRef: string;
  previousState?: string;
  newState?: string;
  notes: string;
  timestamp: string;
}
