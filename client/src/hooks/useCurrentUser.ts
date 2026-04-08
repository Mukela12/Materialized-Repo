import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  username: string;
  role: "creator" | "brand" | "affiliate";
  isAdmin: boolean;
  avatarUrl?: string;
  stripeCustomerId?: string;
  stripeConnectAccountId?: string;
  stripeConnectOnboarded?: boolean;
}

export function useCurrentUser() {
  return useQuery<CurrentUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.status === 401) return null;
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  return useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/logout", {}),
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.invalidateQueries();
      navigate("/");
    },
  });
}
