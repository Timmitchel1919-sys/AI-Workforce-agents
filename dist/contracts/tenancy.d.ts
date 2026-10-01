/**
 * Enterprise Multi-Tenancy & SaaS Control Plane models.
 */
import type { Entity } from "./index.js";
export type TenantId = string;
export type OrganizationId = string;
export type WorkspaceId = string;
export type UserId = string;
/**
 * The Root Organization Model.
 * Provides isolation boundary for billing, quotas, data residency.
 */
export interface Organization extends Entity {
    id: OrganizationId;
    name: string;
    slug: string;
    billingPlan: "free" | "pro" | "enterprise";
    quotas: {
        maxProjects: number;
        maxAgents: number;
        maxWorkspaces: number;
    };
    dataResidencyRegion?: string;
    createdAt: string;
    updatedAt: string;
    status: "active" | "suspended" | "deleted";
}
/**
 * Workspace Model.
 * A division within an Organization. Projects belong to Workspaces.
 */
export interface Workspace extends Entity {
    id: WorkspaceId;
    organizationId: OrganizationId;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    status: "active" | "archived";
}
export type Role = "owner" | "admin" | "member" | "viewer" | "billing_admin";
/**
 * Membership Model.
 * Links Users to Organizations and Workspaces with specific RBAC roles.
 */
export interface Membership extends Entity {
    id: string;
    userId: UserId;
    organizationId: OrganizationId;
    workspaceId?: WorkspaceId;
    roles: Role[];
    permissions?: string[];
    createdAt: string;
    updatedAt: string;
    status: "active" | "invited" | "suspended";
}
/**
 * TenantContext.
 * Injected into operations to ensure strict data access enforcement.
 */
export interface TenantContext {
    organizationId: OrganizationId;
    workspaceId?: WorkspaceId;
    userId?: UserId;
    roles: Role[];
    permissions: string[];
}
export interface TenancyStore {
    getOrganization(id: OrganizationId): Promise<Organization | undefined>;
    createOrganization(org: Organization): Promise<Organization>;
    updateOrganization(id: OrganizationId, updates: Partial<Organization>): Promise<Organization>;
    getWorkspace(id: WorkspaceId): Promise<Workspace | undefined>;
    listWorkspaces(orgId: OrganizationId): Promise<Workspace[]>;
    createWorkspace(workspace: Workspace): Promise<Workspace>;
    getMembership(userId: UserId, orgId: OrganizationId): Promise<Membership | undefined>;
    listMemberships(orgId: OrganizationId): Promise<Membership[]>;
    createMembership(membership: Membership): Promise<Membership>;
}
