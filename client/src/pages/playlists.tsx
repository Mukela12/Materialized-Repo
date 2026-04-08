import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  ListVideo, Trash2, Play, Copy, Check, ChevronRight,
  ExternalLink, BarChart2, CreditCard, Code2, Loader2, Film,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

type PlaylistSummary = {
  id: number;
  name: string;
  description: string | null;
  itemCount: number;
  status: "draft" | "pending_payment" | "published";
  licenseFeeTotal: string | null;
  embedCode: string | null;
  publishedAt: string | null;
  createdAt: string;
};

type PlaylistItem = {
  id: number;
  listingId: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmCode: string | null;
  addedAt: string;
  listing: {
    id: string;
    listingTitle: string | null;
    category: string | null;
    licenseFee: string;
    video: { id: string; title: string; thumbnailUrl: string | null } | null;
    creator: { displayName: string; avatarUrl: string | null } | null;
  } | null;
};

type PlaylistDetail = PlaylistSummary & { items: PlaylistItem[] };

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube",
  website: "Website", twitter: "X (Twitter)", facebook: "Facebook",
  linkedin: "LinkedIn", email: "Email", other: "Other",
};

function buildUtmUrl(baseUrl: string, item: PlaylistItem): string {
  const params = new URLSearchParams();
  if (item.utmSource)   params.set("utm_source", item.utmSource);
  if (item.utmMedium)   params.set("utm_medium", item.utmMedium);
  if (item.utmCampaign) params.set("utm_campaign", item.utmCampaign);
  if (item.utmContent)  params.set("utm_content", item.utmContent ?? "");
  if (item.utmCode)     params.set("utm_id", item.utmCode);
  return `${baseUrl}?${params.toString()}`;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
      title={label ?? "Copy"}
      data-testid="button-copy-utm"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span className="text-xs">{copied ? "Copied!" : label}</span>}
    </button>
  );
}

function StatusBadge({ status }: { status: PlaylistSummary["status"] }) {
  const map = {
    draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
    pending_payment: { label: "Awaiting Payment", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" },
    published: { label: "Published", className: "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400" },
  };
  const { label, className } = map[status] ?? map.draft;
  return <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${className}`}>{label}</span>;
}

export default function PlaylistsPage() {
  const { toast } = useToast();
  const [openPlaylistId, setOpenPlaylistId] = useState<number | null>(null);
  const [showEmbed, setShowEmbed] = useState(false);
  const [checkoutTotal, setCheckoutTotal] = useState<string | null>(null);
  const [checkoutCount, setCheckoutCount] = useState(0);

  const { data: playlists = [], isLoading } = useQuery<PlaylistSummary[]>({
    queryKey: ["/api/playlists"],
  });

  const { data: detail, isLoading: detailLoading } = useQuery<PlaylistDetail>({
    queryKey: ["/api/playlists", openPlaylistId],
    enabled: openPlaylistId !== null,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/playlists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      setOpenPlaylistId(null);
      toast({ title: "Playlist deleted" });
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: ({ playlistId, itemId }: { playlistId: number; itemId: number }) =>
      apiRequest("DELETE", `/api/playlists/${playlistId}/items/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists", openPlaylistId] });
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (playlistId: number) => {
      const res = await apiRequest("POST", `/api/playlists/${playlistId}/checkout`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      return data;
    },
    onSuccess: (data) => {
      setCheckoutTotal(data.totalEur);
      setCheckoutCount(data.videoCount);
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/playlists", openPlaylistId] });
    },
    onError: (e: Error) => {
      toast({ title: "Checkout error", description: e.message, variant: "destructive" });
    },
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async (playlistId: number) => {
      const res = await apiRequest("POST", `/api/playlists/${playlistId}/confirm-payment`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/playlists", openPlaylistId] });
      setCheckoutTotal(null);
      toast({ title: "Published!", description: "Your playlist is live. Embed code is ready." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const openDetail = playlists.find((p) => p.id === openPlaylistId);
  const currentStatus = detail?.status ?? openDetail?.status ?? "draft";

  const handleOpenPlaylist = (id: number) => {
    setOpenPlaylistId(id);
    setShowEmbed(false);
    setCheckoutTotal(null);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Playlists</h1>
        <p className="text-muted-foreground mt-1">
          Video collections from the Global Library — pay the licensing fee to publish and get your embed code.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader>
              <CardContent><Skeleton className="h-4 w-1/2" /></CardContent>
            </Card>
          ))}
        </div>
      ) : playlists.length === 0 ? (
        <Card className="p-12 text-center">
          <ListVideo className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <CardTitle className="mb-2">No playlists yet</CardTitle>
          <CardDescription>
            Go to the Video Library, select videos, and click "Add to Playlist" to get started.
          </CardDescription>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {playlists.map((pl) => (
            <Card
              key={pl.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              data-testid={`card-playlist-${pl.id}`}
              onClick={() => handleOpenPlaylist(pl.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base line-clamp-2 flex-1">{pl.name}</CardTitle>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </div>
                <StatusBadge status={pl.status} />
              </CardHeader>
              <CardContent className="pb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Film className="h-3.5 w-3.5" />
                  <span>{pl.itemCount} video{pl.itemCount !== 1 ? "s" : ""}</span>
                  {pl.licenseFeeTotal && (
                    <>
                      <span>·</span>
                      <span className="font-medium text-foreground">€{pl.licenseFeeTotal}</span>
                    </>
                  )}
                </div>
              </CardContent>
              <CardFooter className="pt-0 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {pl.createdAt ? format(new Date(pl.createdAt), "d MMM yyyy") : ""}
                </span>
                {pl.status !== "published" && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    Pay to publish
                  </span>
                )}
                {pl.status === "published" && (
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                    <Code2 className="h-3 w-3" />
                    Embed ready
                  </span>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Playlist detail sheet */}
      <Sheet open={openPlaylistId !== null} onOpenChange={(o) => !o && setOpenPlaylistId(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between pr-6">
              <span className="flex items-center gap-2">
                <ListVideo className="h-5 w-5 text-primary" />
                {detail?.name ?? openDetail?.name ?? "Playlist"}
              </span>
              <div className="flex items-center gap-2">
                {detail && <StatusBadge status={currentStatus} />}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => openPlaylistId !== null && deleteMutation.mutate(openPlaylistId)}
                  disabled={deleteMutation.isPending}
                  data-testid="button-delete-playlist"
                >
                  {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-5">

            {/* ── Payment / Publish section ── */}
            {currentStatus !== "published" && !detailLoading && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="font-semibold text-sm">License to Publish</span>
                  </div>
                  {detail?.licenseFeeTotal && (
                    <span className="font-bold text-lg">€{detail.licenseFeeTotal}</span>
                  )}
                </div>

                {/* Pending payment — show confirm button */}
                {currentStatus === "pending_payment" && (detail?.licenseFeeTotal || checkoutTotal) && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Payment pending for {detail?.itemCount ?? checkoutCount} video{(detail?.itemCount ?? checkoutCount) !== 1 ? "s" : ""} at €45 each.
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => openPlaylistId && confirmPaymentMutation.mutate(openPlaylistId)}
                      disabled={confirmPaymentMutation.isPending}
                      data-testid="button-confirm-payment-sheet"
                    >
                      {confirmPaymentMutation.isPending
                        ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        : <CreditCard className="h-4 w-4 mr-2" />}
                      Pay €{detail?.licenseFeeTotal ?? checkoutTotal} & Publish
                    </Button>
                  </>
                )}

                {/* Draft — show checkout button */}
                {currentStatus === "draft" && !checkoutTotal && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      License fee: €45 per video × {detail?.itemCount ?? 0} videos = <strong>€{(detail?.itemCount ?? 0) * 45}</strong>
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => openPlaylistId && checkoutMutation.mutate(openPlaylistId)}
                      disabled={checkoutMutation.isPending || !detail?.itemCount}
                      data-testid="button-pay-to-publish"
                    >
                      {checkoutMutation.isPending
                        ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        : <CreditCard className="h-4 w-4 mr-2" />}
                      Pay €{(detail?.itemCount ?? 0) * 45} to Publish
                    </Button>
                  </>
                )}

                {/* After checkout but before confirm */}
                {currentStatus === "draft" && checkoutTotal && (
                  <Button
                    className="w-full"
                    onClick={() => openPlaylistId && confirmPaymentMutation.mutate(openPlaylistId)}
                    disabled={confirmPaymentMutation.isPending}
                    data-testid="button-confirm-payment-after-checkout"
                  >
                    {confirmPaymentMutation.isPending
                      ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      : <CreditCard className="h-4 w-4 mr-2" />}
                    Confirm Payment — Pay €{checkoutTotal}
                  </Button>
                )}
              </div>
            )}

            {/* ── Embed code section (published only) ── */}
            {currentStatus === "published" && (detail?.embedCode || openDetail?.embedCode) && (
              <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Code2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span className="font-semibold text-sm">Embed Code</span>
                  </div>
                  <CopyButton
                    text={(detail?.embedCode ?? openDetail?.embedCode) || ""}
                    label="Copy code"
                  />
                </div>
                {showEmbed ? (
                  <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono" data-testid="embed-code-block">
                    {detail?.embedCode ?? openDetail?.embedCode}
                  </pre>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowEmbed(true)}
                    data-testid="button-show-embed"
                  >
                    <Code2 className="h-4 w-4 mr-2" />
                    Show Embed Code
                  </Button>
                )}
              </div>
            )}

            <Separator />

            {/* ── Video items list ── */}
            {detailLoading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
            ) : !detail?.items?.length ? (
              <p className="text-center text-muted-foreground py-8">This playlist has no videos yet.</p>
            ) : (
              detail.items.map((item) => {
                const title = item.listing?.video?.title || item.listing?.listingTitle || "Untitled Video";
                const creator = item.listing?.creator?.displayName ?? "Unknown";
                const thumb = item.listing?.video?.thumbnailUrl;
                const utmUrl = buildUtmUrl(`${window.location.origin}/watch/${item.listingId}`, item);
                const platformLabel = PLATFORM_LABELS[item.utmSource ?? ""] ?? item.utmSource ?? "—";

                return (
                  <div key={item.id} className="rounded-xl border p-3 flex gap-3" data-testid={`playlist-item-${item.id}`}>
                    <div className="w-24 h-16 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                      {thumb ? (
                        <img src={thumb} alt={title} className="w-full h-full object-cover" />
                      ) : (
                        <Play className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <p className="font-medium text-sm line-clamp-1">{title}</p>
                      <p className="text-xs text-muted-foreground">by {creator}</p>

                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <Badge variant="outline" className="text-[10px] py-0">
                          <BarChart2 className="h-2.5 w-2.5 mr-1" />
                          {platformLabel}
                        </Badge>
                        {item.utmCampaign && (
                          <Badge variant="outline" className="text-[10px] py-0">{item.utmCampaign}</Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">{item.utmCode}</span>
                      </div>

                      <div className="flex items-center gap-1 mt-1">
                        <CopyButton text={utmUrl} />
                        <a
                          href={utmUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
                          data-testid={`link-utm-${item.id}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <button
                          onClick={() => removeItemMutation.mutate({ playlistId: openPlaylistId!, itemId: item.id })}
                          disabled={currentStatus === "published"}
                          className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive ml-auto disabled:opacity-40 disabled:cursor-not-allowed"
                          data-testid={`button-remove-item-${item.id}`}
                          title={currentStatus === "published" ? "Cannot remove from published playlist" : "Remove video"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
