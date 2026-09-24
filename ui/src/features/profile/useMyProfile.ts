import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/useAuth";
import { getMyProfile, removeProfilePhoto, uploadProfilePhoto, type MyProfile } from "./profileClient";

const PROFILE_KEY = ["workforce", "me", "profile"] as const;

/** The caller's own profile; only fetched for an ACTIVE account. */
export function useMyProfile() {
  const { accessToken, access } = useAuth();
  return useQuery({
    queryKey: [...PROFILE_KEY, accessToken ?? "anonymous"],
    queryFn: () => getMyProfile(accessToken),
    enabled: access === "granted" && Boolean(accessToken),
    retry: false,
    staleTime: 60_000,
  });
}

/** Upload (`dataUrl`) or remove (`null`) the caller's profile photo. */
export function useProfilePhoto() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dataUrl: string | null): Promise<MyProfile> =>
      dataUrl ? uploadProfilePhoto(dataUrl, accessToken) : removeProfilePhoto(accessToken),
    onSuccess: (profile) => {
      client.setQueriesData({ queryKey: PROFILE_KEY }, profile);
    },
  });
}
