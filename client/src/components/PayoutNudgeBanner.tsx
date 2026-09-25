/**
 * "Get your payouts ready" — informational, never blocking.
 *
 * The client's distinction, verbatim: "Payout methods installed, while
 * Payment method not required — to ensure the platform can pay out affiliate
 * commissions." A creator can upload from minute one; this just makes sure
 * their first commission has a bank account to land in.
 *
 * Softer than the obligation banners on purpose: blue not amber, dismissible
 * for the session, and the server stands it down whenever a real obligation
 * banner is up so a new account still sees one thing at a time.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Landmark, Loader2, X } from "lucide-react";

const DISMISS_KEY = "payout-nudge-dismissed";

export function PayoutNudgeBanner() {
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  const { data } = useQuery<{ needed: boolean }>({
    queryKey: ["/api/payouts/nudge"],
    queryFn: () => fetch("/api/payouts/nudge", { credentials: "include" }).then((r) => r.json()),
    retry: false,
  });

  const start = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/stripe/connect/create");
      const res = await apiRequest("POST", "/api/stripe/connect/onboarding");
      return res.json();
    },
    onSuccess: (body: { url?: string }) => {
      if (body.url) window.location.href = body.url;
    },
    onError: () => toast({ title: "Could not start payout setup", variant: "destructive" }),
  });

  if (dismissed || !data?.needed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
  };

  return (
    <div
      className="mb-4 rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      data-testid="banner-payout-nudge"
    >
      <div className="flex items-start gap-3">
        <Landmark className="w-4 h-4 mt-0.5 shrink-0 text-sky-500" />
        <div>
          <p className="text-sm font-medium">Get your payouts ready</p>
          <p className="text-xs text-muted-foreground mt-1">
            Commissions are paid to your bank through Stripe. Two minutes now means your
            first sale pays out on the next run — nothing to pay, ever.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          onClick={() => start.mutate()}
          disabled={start.isPending}
          data-testid="button-setup-payouts"
        >
          {start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Set up payouts"}
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Dismiss" data-testid="button-dismiss-payout-nudge">
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
