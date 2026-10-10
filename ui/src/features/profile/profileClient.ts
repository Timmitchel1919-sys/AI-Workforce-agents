/**
 * The signed-in operator's own profile. Same-origin Control Plane only; the
 * backend takes the operator id from the verified token, never from here,
 * and validates the photo (PNG/JPEG/WebP, ≤ 256 KB) before storing it.
 */
import { apiRequest } from "../../api/client";

/** `GET /api/me/profile` (contracts/profile.ts `MyProfileView`). */
export interface MyProfile {
  operatorId: string;
  displayName?: string;
  email?: string;
  emailVerified: boolean;
  role: "viewer" | "operator" | "admin";
  allowedProjects: readonly string[] | "*";
  avatarDataUrl?: string;
}

export function getMyProfile(accessToken?: string | null): Promise<MyProfile> {
  return apiRequest<MyProfile>("/api/me/profile", { method: "GET", accessToken });
}

export function uploadProfilePhoto(dataUrl: string, accessToken?: string | null): Promise<MyProfile> {
  return apiRequest<MyProfile>("/api/me/profile/photo", {
    method: "PUT",
    body: JSON.stringify({ dataUrl }),
    accessToken,
  });
}

export function removeProfilePhoto(accessToken?: string | null): Promise<MyProfile> {
  return apiRequest<MyProfile>("/api/me/profile/photo", { method: "DELETE", accessToken });
}
