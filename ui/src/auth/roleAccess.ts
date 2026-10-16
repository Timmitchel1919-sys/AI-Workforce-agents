import type { AccessDetails } from "./auth.types";

export function allowsRole(role: AccessDetails["role"], required: AccessDetails["role"]): boolean {
  if (!role || !required) return false;
  if (required === "viewer") return true;
  if (required === "operator") return role === "operator" || role === "admin";
  return role === "admin";
}
