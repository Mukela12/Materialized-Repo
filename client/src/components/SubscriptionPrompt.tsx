/**
 * "Choose your plan" — shown when the only thing missing is a subscription.
 *
 * ── Why it exists ────────────────────────────────────────────────────────────
 * A signup without a voucher gets no free period, so the account needs a paid
 * plan. Nothing said so. The user paid the $29, arrived in the portal and found
 * a product that looked available and was not — the client hit this within an
 * hour of her first real brand signup, and correctly called it wrong.
 *
 * ── Why it never appears beside the fee banner ───────────────────────────────
 * Two payment prompts at once read as two bills. The fee is the first thing
 * owed, so this waits until that clears; the server decides which state applies
 * rather than the two components racing each other on screen.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";

interface PromptStatus {
  needed: boolean;
  blockedByFeeFirst: boolean;
  roleLabel: string;
  plan: string | null;
  amount: number | null;
  freeUntil: string | null;
  hasSubscription: boolean;
}

export function SubscriptionPrompt() {
  const { toast } = useToast();

  const { data } = useQuery<PromptStatus>({
    queryKey: ["/api/subscription/prompt"],
    queryFn: () => fetch("/api/subscription/prompt", { credentials: "include" }).then((r) => r.json()),
    retry: false,
  });

  const subscribe = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/checkout");
      return res.json();
    },
    onSuccess: (body: { url?: string }) => {
      if (body.url) window.location.href = body.url;
    },
    onError: () => toast({ title: "Could not start checkout", variant: "destructive" }),
  });

  if (!data?.needed) return null;

  return (
    <div
      className="mb-4 rounded-xl border border-primary/40 bg-primary/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      data-testid="banner-choose-plan"
    >
      <div>
        <p className="text-sm font-medium">Choose your plan to activate your account</p>
        <p className="text-xs text-muted-foreground mt-1">
          {data.roleLabel} accounts are{" "}
          <span className="font-semibold text-foreground">${data.amount}</span> a month. Your account
          is set up — this is the last step before you can publish.
        </p>
      </div>
      <Button
        size="lg"
        onClick={() => subscribe.mutate()}
        disabled={subscribe.isPending}
        className="gap-2 shrink-0 font-bold tracking-wide uppercase shadow-lg shadow-primary/30"
        data-testid="button-choose-plan"
      >
        {subscribe.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
        Choose Plan
      </Button>
    </div>
  );
}
