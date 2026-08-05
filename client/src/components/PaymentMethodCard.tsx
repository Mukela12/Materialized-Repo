/**
 * The card on file, for accounts that do not subscribe.
 *
 * A card could previously only be captured as a side effect of subscribing, so
 * an account on permanent free access had no payment method at all and overage
 * could never be charged to it. A free account is not a no-payment-method
 * account — the two got conflated because subscribing was the only path.
 *
 * Nothing is charged here. It opens Stripe Checkout in setup mode, which vaults
 * the card and makes it the invoice default.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, ShieldCheck } from "lucide-react";

interface CardOnFile {
  id: string;
  brand: string | null;
  last4: string | null;
  isDefault: boolean;
}

export function PaymentMethodCard() {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ card: CardOnFile | null }>({
    queryKey: ["/api/billing/payment-method"],
  });

  const startSetup = useMutation({
    mutationFn: () => apiRequest("POST", "/api/billing/payment-method/setup"),
    onSuccess: async (res: any) => {
      const body = typeof res?.json === "function" ? await res.json() : res;
      if (body?.url) window.location.href = body.url;
      else toast({ title: "Could not open the card form", variant: "destructive" });
    },
    onError: () => toast({ title: "Could not start card setup", variant: "destructive" }),
  });

  const card = data?.card ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Payment method
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Used only if your usage goes over your plan's allowance. Nothing is charged
          to add it.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : card ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm" data-testid="text-card-on-file">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
              <span className="capitalize">{card.brand ?? "Card"}</span>
              <span className="text-muted-foreground">ending {card.last4 ?? "••••"}</span>
            </div>
            <Button
              variant="outline" size="sm"
              onClick={() => startSetup.mutate()}
              disabled={startSetup.isPending}
              data-testid="button-replace-card"
            >
              Replace
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">No card on file.</p>
            <Button
              size="sm"
              onClick={() => startSetup.mutate()}
              disabled={startSetup.isPending}
              data-testid="button-add-card"
            >
              {startSetup.isPending ? "Opening…" : "Add a card"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
