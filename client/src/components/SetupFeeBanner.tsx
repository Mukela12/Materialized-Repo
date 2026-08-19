/**
 * The one-time admin setup fee, asked for where it cannot be missed.
 *
 * ── Why a banner and not a page ──────────────────────────────────────────────
 * Entitlement now treats the fee as a precondition, so a Brand or Publisher who
 * has not paid it is blocked everywhere. Without something on screen saying WHY,
 * that reads as a broken account: the voucher worked, they are signed in, and
 * nothing functions. This is the explanation and the way out, on every page of
 * their portal until it is settled.
 *
 * Creators never see it — they owe nothing.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2 } from "lucide-react";

interface SetupFeeStatus {
  required: boolean;
  paid: boolean;
  outstanding: boolean;
  amount: number;
  audience: string;
}

export function SetupFeeBanner() {
  const { toast } = useToast();

  const { data } = useQuery<SetupFeeStatus>({
    queryKey: ["/api/setup-fee/status"],
    queryFn: () => fetch("/api/setup-fee/status", { credentials: "include" }).then((r) => r.json()),
    retry: false,
  });

  const pay = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/setup-fee/checkout");
      return res.json();
    },
    onSuccess: (body: { url?: string; alreadyPaid?: boolean }) => {
      if (body.alreadyPaid) {
        toast({ title: "Already paid", description: "Your setup fee is settled." });
        return;
      }
      if (body.url) {
        // Stripe's hosted page — a full navigation, not a new tab, so the
        // return lands back in the portal with the session cookie intact.
        window.location.href = body.url;
      }
    },
    onError: () => toast({ title: "Could not start payment", variant: "destructive" }),
  });

  if (!data?.outstanding) return null;

  return (
    <div
      className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      data-testid="banner-setup-fee"
    >
      <div>
        <p className="text-sm font-medium">One-time admin setup fee outstanding</p>
        <p className="text-xs text-muted-foreground mt-1">
          Every {data.audience} account pays a one-off{" "}
          <span className="font-semibold text-foreground">${data.amount}</span> setup fee. Your
          subscription is covered by your voucher, but this is still to pay before your account is
          active.
        </p>
      </div>
      {/* The client: "PAY NOW capitals. Remove $29 as it is repetitive. This is
          a call to action, and it should stand out more vibrantly." The amount
          is already in the sentence above it, so the button carries the verb
          alone and is sized and coloured to be the thing you look at. */}
      <Button
        size="lg"
        onClick={() => pay.mutate()}
        disabled={pay.isPending}
        className="gap-2 shrink-0 font-bold tracking-wide uppercase bg-amber-500 hover:bg-amber-600 text-black shadow-lg shadow-amber-500/30"
        data-testid="button-pay-setup-fee"
      >
        {pay.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
        Pay Now
      </Button>
    </div>
  );
}
