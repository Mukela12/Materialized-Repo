import { useQuery } from "@tanstack/react-query";

/** Whether this account may send program invites, and what it has left. See pages/program-invites.tsx. */
export interface ProgramMe {
  enabled: boolean;
  programName?: string;
  senderName?: string;
  seats?: Record<"brand" | "creator", { limit: number; sent: number; remaining: number; offer: string | null; problem: string | null }>;
  defaultSubject?: string;
  defaultMessage?: string;
  maxRecipients?: number;
  emailReady?: boolean;
}

export function useProgram() {
  return useQuery<ProgramMe>({ queryKey: ["/api/program/me"], staleTime: 60_000 });
}

/** Where the invite page lives for each kind of account. */
export const programInvitesPath = (role: string | undefined) =>
  role === "affiliate" ? "/affiliate/invites" : role === "brand" ? "/brand/invites" : "/creator/invites";
