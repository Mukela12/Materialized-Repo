/**
 * The marketplace fee a brand agrees to (client, 29 Sep 2026): "15%
 * marketplace fee (includes in-video transactions; merchant fee; affiliate
 * commission to publishers. Does not include Brand's existing Influencer
 * fees)". Shown on the brand sign-up form and, once, to brands who signed up
 * before it existed or before the rate changed. The rate comes from the
 * server, so the words always match what is charged.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, serverMessage } from "@/lib/queryClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export function useFeeTerms() {
  return useQuery<{ marketplaceFeePct: number }>({ queryKey: ["/api/fee-terms"] });
}

const pctLabel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/** What the fee covers and what it doesn't, in the client's terms. */
export function FeeTermsSummary({ pct }: { pct: number }) {
  return (
    <div className="space-y-2 text-sm" data-testid="fee-terms-summary">
      <p>
        Materialized takes <span className="font-semibold">{pctLabel(pct)}</span> of each sale a
        creator's video drives. That covers:
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
        <li>in-video checkout</li>
        <li>card processing (merchant) fees</li>
        <li>commission to the publishers who share your videos</li>
      </ul>
      <p className="text-muted-foreground">
        It doesn't include what you already pay your own influencers or creators.
      </p>
    </div>
  );
}

/**
 * True while a brand still has to agree to the current fee. Other first-visit
 * overlays (the tour) wait for it, so two never open on top of each other.
 */
export function useFeeTermsPending(): boolean {
  const { data: user } = useCurrentUser();
  const { data: terms } = useFeeTerms();
  if (!user || !terms || user.role !== "brand" || user.isAdmin) return false;
  return !user.feeTermsAcceptedAt || Number(user.feeTermsPct) !== Number(terms.marketplaceFeePct);
}

/**
 * Asks a brand account that has not agreed to the current rate. Shown once;
 * it cannot be dismissed without agreeing, because every sale carries the fee.
 */
export function FeeTermsGate() {
  const { data: user } = useCurrentUser();
  const { data: terms } = useFeeTerms();
  const pending = useFeeTermsPending();
  const { toast } = useToast();

  const accept = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/fee-terms/accept")).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }),
    onError: (err: unknown) =>
      toast({ title: "Couldn't save that", description: serverMessage(err) || "Please try again.", variant: "destructive" }),
  });

  if (!pending || !user || !terms) return null;

  return (
    <Dialog open>
      <DialogContent
        className="[&>button:last-child]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="dialog-fee-terms"
      >
        <DialogHeader>
          <DialogTitle>Marketplace fee: {pctLabel(terms.marketplaceFeePct)}</DialogTitle>
          <DialogDescription>
            {user.feeTermsAcceptedAt
              ? "The marketplace fee has changed. Please confirm the new rate to carry on."
              : "One quick thing before you carry on."}
          </DialogDescription>
        </DialogHeader>
        <FeeTermsSummary pct={terms.marketplaceFeePct} />
        <DialogFooter>
          <Button onClick={() => accept.mutate()} disabled={accept.isPending} data-testid="button-accept-fee-terms">
            {accept.isPending ? "Saving…" : `I agree to the ${pctLabel(terms.marketplaceFeePct)} fee`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
