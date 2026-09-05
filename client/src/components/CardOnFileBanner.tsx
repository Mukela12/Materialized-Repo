/**
 * "Add a card to activate your free access."
 *
 * The client's rule: overage accountability is the single requirement of
 * having free access, so a voucher account is blocked until a card is vaulted.
 * Same shape as SetupFeeBanner, and never shown beside it — the server's
 * status endpoint stands down while the $29 is still owed, so a new account is
 * asked for one thing at a time.
 *
 * The consent language lives HERE, on the button that starts the vaulting,
 * because Stripe's setup page itself charges nothing and says so — this is the
 * one screen where the agreement is actually made.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2 } from "lucide-react";

interface CardStatus {
  required: boolean;
  onFile: boolean;
  outstanding: boolean;
}

export function CardOnFileBanner() {
  const { toast } = useToast();

  const { data } = useQuery<CardStatus>({
    queryKey: ["/api/card/status"],
    queryFn: () => fetch("/api/card/status", { credentials: "include" }).then((r) => r.json()),
    retry: false,
  });

  const start = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/card/checkout");
      return res.json();
    },
    onSuccess: (body: { url?: string; alreadyOnFile?: boolean }) => {
      if (body.alreadyOnFile) {
        toast({ title: "Card already saved" });
        return;
      }
      if (body.url) window.location.href = body.url;
    },
    onError: () => toast({ title: "Could not start card setup", variant: "destructive" }),
  });

  if (!data?.outstanding) return null;

  return (
    <div
      className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      data-testid="banner-card-on-file"
    >
      <div>
        <p className="text-sm font-medium">Add a card to activate your free access</p>
        <p className="text-xs text-muted-foreground mt-1">
          Nothing is charged today and your free period stays free. By saving a card you agree that
          usage beyond your plan's included allowance may be billed to it.
        </p>
      </div>
      <Button
        size="lg"
        onClick={() => start.mutate()}
        disabled={start.isPending}
        className="gap-2 shrink-0 font-bold tracking-wide uppercase bg-amber-500 hover:bg-amber-600 text-black shadow-lg shadow-amber-500/30"
        data-testid="button-add-card"
      >
        {start.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
        Add Card
      </Button>
    </div>
  );
}
