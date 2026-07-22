import { useQuery } from "@tanstack/react-query";

/**
 * Shared mailbox unread-count query, used by the nav badges. Polls lightly so
 * the badge stays roughly current without a websocket; mark-read mutations
 * invalidate this key for an immediate update.
 */
export function useMailboxUnreadCount() {
  return useQuery<number>({
    queryKey: ["/api/mailbox/unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/mailbox/unread-count", { credentials: "include" });
      if (!res.ok) return 0;
      const data = await res.json();
      return typeof data?.count === "number" ? data.count : 0;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
