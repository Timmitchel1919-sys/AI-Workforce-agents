import type { Entity } from "./persistence.js";

export const DATA_CLASSIFICATION_LEVELS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export type DataClassificationLevel = typeof DATA_CLASSIFICATION_LEVELS[number];

export interface DataAsset extends Entity {
  assetId: string;
  name: string;
  description: string;
  ownerId: string;
  systemRef: string;
  classification: DataClassificationLevel;
  containsPersonalData: boolean;
  retentionPolicyRef?: string;
  residencyRegion?: string;
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
  createdAt: string;
  updatedAt: string;
}

export interface DataRetentionPolicy extends Entity {
  policyId: string;
  name: string;
  description: string;
  retentionDays: number;
  dataCategory: string;
  legalHoldActive: boolean;
  ownerId: string;
  createdAt: string;
}

export interface DataSubjectRequestRecord extends Entity {
  requestId: string;
  subjectId: string;
  type: "ACCESS" | "EXPORT" | "DELETION" | "CORRECTION";
  status: "RECEIVED" | "VERIFIED" | "IN_PROGRESS" | "FULFILLED" | "REJECTED";
  targetAssetRefs: readonly string[];
  createdAt: string;
  resolvedAt?: string;
}
