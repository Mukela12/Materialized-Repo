import { CURRENCY_SYMBOL } from "@/lib/currency";
import { LICENSE_FEE_PER_VIDEO, tokensForFee } from "@shared/pricing";
import { isPlaylistLocked, playlistLockedMessage } from "@shared/playlists";
import { TokenPayOption } from "@/components/TokenPayOption";
import { walletPost, useInvalidateWallet, tokenLabel } from "@/hooks/useWallet";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ListVideo, Plus, Loader2, CheckCircle2, CreditCard, Save, DollarSign, Film } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

const PLATFORMS = [
  { value: "instagram",  label: "Instagram" },
  { value: "tiktok",    label: "TikTok" },
  { value: "youtube",   label: "YouTube" },
  { value: "website",   label: "Website / Blog" },
  { value: "twitter",   label: "X (Twitter)" },
  { value: "facebook",  label: "Facebook" },
  { value: "linkedin",  label: "LinkedIn" },
  { value: "email",     label: "Email / Newsletter" },
  { value: "other",     label: "Other" },
];

const LICENSE_FEE = LICENSE_FEE_PER_VIDEO;

/** Whole tokens per video. null (never today) means "not payable in tokens". */
const TOKENS_PER_VIDEO = tokensForFee(LICENSE_FEE_PER_VIDEO);

/**
 * CARD PUBLISHING IS OFF, and these buttons say so instead of failing.
 *
 * POST /api/playlists/:id/confirm-payment used to publish unconditionally — it
 * never read stripePaymentIntentId and never called Stripe, so anyone could
 * checkout-then-confirm and publish for FREE. It now requires a genuinely
 * succeeded PaymentIntent, which is correct, but nothing in the client ever
 * consumes the `clientSecret` that /checkout returns: there is no card-entry
 * form, so no PaymentIntent can ever succeed and the button can only ever 402.
 *
 * A dead button that takes money-shaped actions is worse than an absent one, so
 * it is disabled here rather than re-opening the free-publish hole. Re-enable by
 * mounting Stripe Elements on the clientSecret — NOT by relaxing the server.
 */
const CARD_PUBLISH_ENABLED = false;
const CARD_PUBLISH_NOTE =
  "Card checkout isn't available yet — the payment form is still being wired up. Publish with tokens above, or save a draft and come back.";

type PlaylistEntry = { id: number; name: string; description: string | null; itemCount: number; status?: string };
type Step = "form" | "payment" | "done";

interface Props {
  open: boolean;
  onClose: () => void;
  selectedListingIds: string[];
}

export function AddToPlaylistModal({ open, onClose, selectedListingIds }: Props) {
  const { toast } = useToast();
  const invalidateWallet = useInvalidateWallet();
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [utmSource, setUtmSource] = useState("instagram");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [savedPlaylistId, setSavedPlaylistId] = useState<number | null>(null);
  const [paymentTotal, setPaymentTotal] = useState<string>("0");

  const { data: playlists = [], isLoading } = useQuery<PlaylistEntry[]>({
    queryKey: ["/api/playlists"],
    enabled: open,
  });

  const selectedPlaylist = playlists.find((p) => String(p.id) === selectedPlaylistId);

  /**
   * The server charges for EVERY video in the playlist, not just the ones being
   * added now (`items.length * LICENSE_FEE_PER_VIDEO` in /api/playlists/:id/checkout).
   * Quoting only `selectedListingIds.length` under-quotes anyone adding to a playlist
   * that already has videos — harmless-looking with a card, but with tokens it would
   * debit more tokens than the button promised. Quote what will actually be charged.
   */
  const existingItemCount = tab === "existing" ? (selectedPlaylist?.itemCount ?? 0) : 0;
  const projectedItemCount = existingItemCount + selectedListingIds.length;
  const totalFee = projectedItemCount * LICENSE_FEE;
  /**
   * A playlist's contents FREEZE once money is committed against a video count —
   * POST /api/playlists/:id/items 409s on those statuses. The rule and the wording
   * come from @shared/playlists so this can never disagree with the server.
   */
  const lockedStatus = tab === "existing" && isPlaylistLocked(selectedPlaylist?.status)
    ? selectedPlaylist!.status!
    : null;
  const lockedReason = lockedStatus ? playlistLockedMessage(lockedStatus) : null;

  const saveItems = async (asDraft: boolean): Promise<number> => {
    let playlistId: number;

    if (tab === "new") {
      if (!newName.trim()) throw new Error("Playlist name required");
      const res = await apiRequest("POST", "/api/playlists", { name: newName.trim() });
      const pl = await res.json();
      playlistId = pl.id;
    } else {
      if (!selectedPlaylistId) throw new Error("Select a playlist");
      playlistId = Number(selectedPlaylistId);
    }

    await apiRequest("POST", `/api/playlists/${playlistId}/items`, {
      listingIds: selectedListingIds,
      utmSource,
      utmMedium: "video",
      utmCampaign: utmCampaign.trim() || undefined,
    });

    return playlistId;
  };

  const saveDraftMutation = useMutation({
    mutationFn: () => saveItems(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      setStep("done");
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const playlistId = await saveItems(false);
      setSavedPlaylistId(playlistId);
      const res = await apiRequest("POST", `/api/playlists/${playlistId}/checkout`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      setPaymentTotal(data.total ?? data.totalEur);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      setStep("payment");
    },
    onError: (e: Error) => {
      toast({ title: "Payment error", description: e.message, variant: "destructive" });
    },
  });

  /**
   * Save the items, then settle the whole playlist in tokens. One request does the
   * debit and the publish, so unlike the card path there is no separate confirm step.
   */
  const tokenPublishMutation = useMutation({
    mutationFn: async () => {
      const playlistId = await saveItems(false);
      setSavedPlaylistId(playlistId);
      const { ok, data } = await walletPost(`/api/playlists/${playlistId}/checkout`, {
        payWith: "tokens",
      });
      if (!ok) {
        if (data.balance !== undefined && data.required !== undefined) {
          throw new Error(
            `You have ${tokenLabel(data.balance)} — this playlist costs ${tokenLabel(data.required)}. ` +
            `Your videos were saved as a draft, so nothing is lost.`,
          );
        }
        throw new Error(data.error || "Token payment failed");
      }
      return data;
    },
    onSuccess: (data) => {
      invalidateWallet();
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      setStep("done");
      toast({
        title: "Published with tokens",
        description: `${tokenLabel(data.tokensSpent ?? 0)} used. Your embed code is ready.`,
      });
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      toast({ title: "Couldn't pay with tokens", description: e.message, variant: "destructive" });
    },
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!savedPlaylistId) throw new Error("No playlist");
      const res = await apiRequest("POST", `/api/playlists/${savedPlaylistId}/confirm-payment`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Confirmation failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      setStep("done");
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    setStep("form");
    setTab("existing");
    setSelectedPlaylistId("");
    setNewName("");
    setUtmCampaign("");
    setSavedPlaylistId(null);
    onClose();
  };

  const isFormValid =
    !lockedStatus &&
    ((tab === "existing" && !!selectedPlaylistId) ||
      (tab === "new" && !!newName.trim()));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListVideo className="h-5 w-5 text-primary" />
            {step === "payment" ? "Complete Payment" : step === "done" ? "All Done!" : "Add to Playlist"}
          </DialogTitle>
        </DialogHeader>

        {/* ── DONE state ── */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="font-semibold text-lg">Saved successfully!</p>
            <p className="text-sm text-muted-foreground">
              {selectedListingIds.length} video{selectedListingIds.length !== 1 ? "s" : ""} added to your playlist.
              {savedPlaylistId
                ? " Your playlist has been published and embed code is ready."
                : " Pay when you're ready to publish and get your embed code."}
            </p>
            <Button onClick={handleClose} className="mt-2 rounded-full" data-testid="button-done-playlist">Done</Button>
          </div>
        )}

        {/* ── PAYMENT state ── */}
        {step === "payment" && (
          <div className="space-y-5 py-2">
            <div className="rounded-xl bg-muted/50 border p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CreditCard className="h-4 w-4 text-primary" />
                Licensing Fee Summary
              </div>
              <Separator />
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Film className="h-3.5 w-3.5" />
                    {selectedListingIds.length} video{selectedListingIds.length !== 1 ? "s" : ""} × {CURRENCY_SYMBOL}{LICENSE_FEE}
                  </span>
                  <span>{CURRENCY_SYMBOL}{paymentTotal}</span>
                </div>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold">
                <span>Total due</span>
                <span className="text-primary text-lg">{CURRENCY_SYMBOL}{paymentTotal}</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              This licenses each selected video for use in your published playlist. Once paid, you'll receive an embeddable widget code with full UTM tracking.
            </p>
            {/* See CARD_PUBLISH_ENABLED: the server now demands a real succeeded
                PaymentIntent and no card-entry UI exists to produce one. */}
            <p className="text-xs text-muted-foreground" data-testid="text-card-unavailable">
              {CARD_PUBLISH_NOTE} Your playlist is already saved as a draft — you can publish it with
              tokens from My Playlists at any time.
            </p>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleClose}
                data-testid="button-pay-later"
              >
                Pay Later (Draft Saved)
              </Button>
              <Button
                className="flex-1"
                onClick={() => confirmPaymentMutation.mutate()}
                disabled={!CARD_PUBLISH_ENABLED || confirmPaymentMutation.isPending}
                title={CARD_PUBLISH_ENABLED ? undefined : CARD_PUBLISH_NOTE}
                data-testid="button-confirm-payment"
              >
                {confirmPaymentMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <CreditCard className="h-4 w-4 mr-2" />}
                Pay {CURRENCY_SYMBOL}{paymentTotal}
              </Button>
            </div>
          </div>
        )}

        {/* ── FORM state ── */}
        {step === "form" && (
          <>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {selectedListingIds.length} video{selectedListingIds.length !== 1 ? "s" : ""} selected
                </Badge>
              </div>

              {/* Playlist selection */}
              <Tabs value={tab} onValueChange={(v) => setTab(v as "existing" | "new")}>
                <TabsList className="w-full">
                  <TabsTrigger value="existing" className="flex-1" data-testid="tab-existing-playlist">
                    Existing Playlist
                  </TabsTrigger>
                  <TabsTrigger value="new" className="flex-1" data-testid="tab-new-playlist">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    New Playlist
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="existing" className="mt-3">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-16">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : playlists.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No playlists yet. Create one using the "New Playlist" tab.
                    </p>
                  ) : (
                    <div className="grid gap-2 max-h-40 overflow-y-auto pr-1">
                      {playlists.map((pl) => (
                        <button
                          key={pl.id}
                          data-testid={`playlist-option-${pl.id}`}
                          onClick={() => setSelectedPlaylistId(String(pl.id))}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                            selectedPlaylistId === String(pl.id)
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{pl.name}</span>
                            {pl.status && (
                              <Badge
                                variant={pl.status === "published" ? "default" : "secondary"}
                                className="text-xs capitalize"
                              >
                                {pl.status}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{pl.itemCount} video{pl.itemCount !== 1 ? "s" : ""}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="new" className="mt-3 space-y-3">
                  <div>
                    <Label htmlFor="playlist-name">Playlist name</Label>
                    <Input
                      id="playlist-name"
                      placeholder="e.g., Summer Campaign 2026"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      data-testid="input-playlist-name"
                    />
                  </div>
                </TabsContent>
              </Tabs>

              {/* UTM settings */}
              <div className="border-t pt-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  UTM Tracking
                </p>

                <div>
                  <Label htmlFor="utm-source">Publishing platform</Label>
                  <Select value={utmSource} onValueChange={setUtmSource}>
                    <SelectTrigger id="utm-source" data-testid="select-utm-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="utm-campaign">
                    Campaign name <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="utm-campaign"
                    placeholder="e.g., summer_2026"
                    value={utmCampaign}
                    onChange={(e) => setUtmCampaign(e.target.value)}
                    data-testid="input-utm-campaign"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Each video gets a unique UTM code so you can track clicks, conversions and commissions per platform and publisher.
                </p>
              </div>

              {/* Licensing cost summary */}
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <DollarSign className="h-3.5 w-3.5" />
                  Licensing Fee
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">
                    {projectedItemCount} video{projectedItemCount !== 1 ? "s" : ""} × {CURRENCY_SYMBOL}{LICENSE_FEE}
                  </span>
                  <span className="font-bold text-base">{CURRENCY_SYMBOL}{totalFee}</span>
                </div>
                {existingItemCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Includes {existingItemCount} video{existingItemCount !== 1 ? "s" : ""} already in this
                    playlist — the fee covers the whole playlist, not just the new additions.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Required before embed code is issued. Save as draft to pay later.
                </p>
                {!CARD_PUBLISH_ENABLED && (
                  <p className="text-xs text-muted-foreground" data-testid="text-card-disabled-form">
                    {CARD_PUBLISH_NOTE}
                  </p>
                )}
              </div>

              {/* Pay with tokens — shown whenever the playlist can be published,
                  disabled with the reason on screen when the balance is short. */}
              {TOKENS_PER_VIDEO !== null && (
                <TokenPayOption
                  required={TOKENS_PER_VIDEO * projectedItemCount}
                  usdAmount={totalFee}
                  title="Publish with tokens instead"
                  breakdown={`${projectedItemCount} video${projectedItemCount !== 1 ? "s" : ""} × ${tokenLabel(TOKENS_PER_VIDEO)} (${CURRENCY_SYMBOL}${LICENSE_FEE}) each. Tokens are spent whole.`}
                  onPay={() => tokenPublishMutation.mutate()}
                  isPending={tokenPublishMutation.isPending}
                  blockedReason={
                    lockedReason
                      ?? (!isFormValid
                        ? tab === "new"
                          ? "Name your new playlist first."
                          : "Choose a playlist first."
                        : null)
                  }
                  testId="modal-token-pay"
                />
              )}
            </div>

            <DialogFooter className="gap-2 flex-col sm:flex-row">
              <Button
                variant="outline"
                onClick={() => saveDraftMutation.mutate()}
                disabled={saveDraftMutation.isPending || checkoutMutation.isPending || tokenPublishMutation.isPending || !isFormValid}
                data-testid="button-save-draft"
                className="flex-1"
              >
                {saveDraftMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <Save className="h-4 w-4 mr-2" />}
                Save Draft
              </Button>
              {/* Disabled, not removed: this button only leads to the confirm step
                  above, which cannot succeed without a card form. Starting the card
                  flow would also move the playlist to `pending_payment` and freeze
                  its contents for a payment that can never complete. */}
              <Button
                onClick={() => checkoutMutation.mutate()}
                disabled={!CARD_PUBLISH_ENABLED || checkoutMutation.isPending || saveDraftMutation.isPending || tokenPublishMutation.isPending || !isFormValid}
                title={CARD_PUBLISH_ENABLED ? undefined : CARD_PUBLISH_NOTE}
                data-testid="button-pay-publish"
                className="flex-1"
              >
                {checkoutMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <CreditCard className="h-4 w-4 mr-2" />}
                Pay {CURRENCY_SYMBOL}{totalFee} & Publish
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
