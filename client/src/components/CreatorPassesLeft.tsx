/**
 * "7 of 10 creator passes left". Every creator a brand invites gets a free
 * pass, and passes are limited per brand (10 for Brooklyn). The client asked
 * for brands to see the count (29 Sep 2026) so the limit is never a surprise.
 */
import { useQuery } from "@tanstack/react-query";
import { Ticket } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InvitePasses { limit: number; used: number; remaining: number }

export function useInvitePasses() {
  return useQuery<InvitePasses>({ queryKey: ["/api/brands/invite-passes"] });
}

export function CreatorPassesLeft({ className }: { className?: string }) {
  const { data } = useInvitePasses();
  if (!data) return null;
  const out = data.remaining === 0;
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        out ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-primary/10 text-primary",
        className,
      )}
      data-testid="text-creator-passes-left"
    >
      <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
      {out
        ? `All ${data.limit} creator passes used`
        : `${data.remaining} of ${data.limit} creator ${data.limit === 1 ? "pass" : "passes"} left`}
    </p>
  );
}
