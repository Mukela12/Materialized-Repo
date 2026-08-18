import { useState, useEffect, useRef } from "react";
import { ImageDropField } from "@/components/ImageDropField";
import { VideoCarouselOverride } from "@/components/VideoCarouselOverride";
import { useUpload } from "@/hooks/use-upload";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Eye, MousePointer, DollarSign, Image, CheckSquare, Square, Plus, Trash2, Link, ExternalLink, Library, CheckCircle2, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Video } from "@shared/schema";
import { LICENSE_FEE, tokensForFee } from "@shared/pricing";
import { CURRENCY_SYMBOL } from "@/lib/currency";
import { TokenPayOption } from "@/components/TokenPayOption";
import { walletPost, useInvalidateWallet, tokenLabel } from "@/hooks/useWallet";
import { OverlayComposer } from "@/components/OverlayComposer";

const CATEGORIES = [
  { value: "fashion",     label: "Fashion",          color: "bg-pink-500/15 text-pink-600 border-pink-500/20" },
  { value: "travel",      label: "Travel",            color: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  { value: "skincare",    label: "Skincare",          color: "bg-violet-500/15 text-violet-600 border-violet-500/20" },
  { value: "cuisine_bev", label: "Cuisine & Bev",     color: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  { value: "health",      label: "Health",            color: "bg-green-500/15 text-green-600 border-green-500/20" },
  { value: "eco",         label: "Eco",               color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  { value: "interiors",   label: "Interiors",         color: "bg-stone-500/15 text-stone-600 border-stone-500/20" },
];

function parseCategories(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/** Whole tokens to list one video. null would mean "not payable in tokens". */
const TOKENS_TO_LIST = tokensForFee(LICENSE_FEE);

/** Only the fields this component needs off GET /api/library. */
type LibraryListingRef = { id: string; videoId: string; publishStatus: string | null };

interface ManualProduct {
  id: string;
  productId?: string;
  name?: string;
  buyUrl?: string;
  price?: string | null;
  imageUrl?: string | null;
  startTime: number;
  endTime: number;
  product?: {
    id: string;
    name: string;
    productUrl: string;
    buyUrl?: string;
    price?: string | null;
    imageUrl?: string | null;
  };
}

interface Props {
  video: Video | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VideoDetailSheet({ video, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories]   = useState<string[]>([]);
  const [thumbUrl, setThumbUrl]       = useState("");
  const [editingThumb, setEditingThumb] = useState(false);
  const [dragActive, setDragActive]     = useState(false);
  const [thumbUploading, setThumbUploading] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  /**
   * Upload a dropped/chosen image and use the hosted URL as the thumbnail.
   * Shared with the video upload path, so thumbnails land in the same place
   * rather than depending on the creator hosting an image themselves.
   */
  const { uploadFile } = useUpload();
  const handleThumbFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Not an image", description: "Choose a JPG, PNG or WebP.", variant: "destructive" });
      return;
    }
    setThumbUploading(true);
    try {
      const res = await uploadFile(file);
      const url = (res as any)?.objectUrl ?? (res as any)?.secure_url ?? (res as any)?.url;
      if (!url) throw new Error("Upload returned no URL");
      setThumbUrl(url);
      toast({ title: "Thumbnail ready", description: "Save to apply it." });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message ?? "Please try again.", variant: "destructive" });
    } finally {
      setThumbUploading(false);
    }
  };

  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl]   = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [showAddProduct, setShowAddProduct] = useState(false);


  useEffect(() => {
    if (video) {
      setTitle(video.title ?? "");
      setDescription(video.description ?? "");
      setCategories(parseCategories(video.categories));
      setThumbUrl(video.thumbnailUrl ?? "");
      setEditingThumb(false);
    }
    setShowAddProduct(false);
    setProductName("");
    setProductUrl("");
    setProductPrice("");
  }, [video]);

  const { data: carouselData, refetch: refetchCarousel } = useQuery<{ products?: ManualProduct[] } | null>({
    queryKey: ["/api/videos", video?.id, "carousel"],
    enabled: !!video?.id && open,
  });

  const manualProducts: ManualProduct[] = carouselData?.products ?? [];

  // ── Global Video Library listing ──────────────────────────────────────────
  const invalidateWallet = useInvalidateWallet();

  const { data: libraryListings = [] } = useQuery<LibraryListingRef[]>({
    queryKey: ["/api/library"],
    enabled: open,
  });

  const existingListing = libraryListings.find((l) => l.videoId === video?.id);
  const isListed = existingListing?.publishStatus === "published";

  /**
   * List this video in the Global Video Library, paid in tokens.
   *
   * Two endpoints, because a token payment can fail AFTER the listing row is
   * created (the listing then sits unpublished, and POST /api/library/list would
   * reject the retry with "already listed"). If we can see such a row, pay it off
   * through the retry endpoint instead of trying to create a second one.
   */
  const listWithTokensMutation = useMutation({
    mutationFn: async () => {
      const pending = existingListing && existingListing.publishStatus !== "published"
        ? existingListing
        : null;

      const { ok, data } = pending
        ? await walletPost(`/api/library/${pending.id}/pay-with-tokens`, {})
        : await walletPost("/api/library/list", {
            videoId: video!.id,
            payWith: "tokens",
            listingTitle: title.trim() || undefined,
            category: categories[0],
          });

      if (!ok) {
        if (data.balance !== undefined && data.required !== undefined) {
          throw new Error(
            `You have ${tokenLabel(data.balance)} — listing costs ${tokenLabel(data.required)}.`,
          );
        }
        throw new Error(data.error || "Couldn't list this video");
      }
      return data;
    },
    onSuccess: (data: any) => {
      invalidateWallet();
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      toast({
        title: data?.alreadyPaid ? "Listing published" : "Listed in the Global Video Library",
        description: data?.alreadyPaid
          ? "This listing had already been paid for and is now live."
          : `${tokenLabel(data?.tokensSpent ?? TOKENS_TO_LIST ?? 1)} used. Affiliates can now license this video.`,
      });
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
      toast({ title: "Couldn't list this video", description: e.message, variant: "destructive" });
    },
  });

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/videos/${video!.id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/videos/library"] });
      toast({ title: "Saved", description: "Video updated successfully." });
      onOpenChange(false);
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to save changes.", variant: "destructive" }),
  });

  const addProductMutation = useMutation({
    mutationFn: async (data: { name: string; buyUrl: string; price?: string }) =>
      apiRequest("POST", `/api/videos/${video!.id}/carousel/products`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos", video?.id, "carousel"] });
      refetchCarousel();
      toast({ title: "Product Added", description: "The product link has been added to the carousel." });
      setProductName("");
      setProductUrl("");
      setProductPrice("");
      setShowAddProduct(false);
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to add product.", variant: "destructive" }),
  });

  const removeProductMutation = useMutation({
    mutationFn: async (productId: string) =>
      apiRequest("DELETE", `/api/videos/${video!.id}/carousel/products/${productId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos", video?.id, "carousel"] });
      refetchCarousel();
      toast({ title: "Removed", description: "Product link removed from carousel." });
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to remove product.", variant: "destructive" }),
  });

  // Overlays
  function toggleCategory(val: string) {
    setCategories((prev) =>
      prev.includes(val) ? prev.filter((c) => c !== val) : prev.length < 3 ? [...prev, val] : prev
    );
  }

  function handleSave() {
    mutation.mutate({
      title,
      description,
      categories: JSON.stringify(categories),
      ...(thumbUrl !== video?.thumbnailUrl ? { thumbnailUrl: thumbUrl } : {}),
    });
  }

  function handleAddProduct() {
    if (!productName.trim() || !productUrl.trim()) return;
    addProductMutation.mutate({
      name: productName.trim(),
      buyUrl: productUrl.trim(),
      ...(productPrice.trim() ? { price: productPrice.trim() } : {}),
    });
  }

  if (!video) return null;

  const views   = video.totalViews ?? 0;
  const clicks  = video.totalClicks ?? 0;
  const revenue = Number(video.totalRevenue ?? 0).toFixed(2);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto flex flex-col gap-0 p-0"
        data-testid="sheet-video-detail"
      >
        {/* Thumbnail */}
        <div className="relative aspect-video bg-muted shrink-0">
          {thumbUrl ? (
            <img src={thumbUrl} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-chart-2/20">
              <Image className="h-12 w-12 text-primary/40" />
            </div>
          )}
          <button
            data-testid="button-change-thumbnail"
            onClick={() => setEditingThumb((p) => !p)}
            className="absolute bottom-3 right-3 bg-black/60 hover:bg-black/80 text-white text-xs px-3 py-1.5 rounded-full transition-colors"
          >
            {editingThumb ? "Cancel" : "Change thumbnail"}
          </button>
        </div>

        {/*
          Client's review: "delete Thumbnail URL field, and replace with Drag and
          Drop Here or Choose from Computer". Asking a creator to paste a hosted
          image URL meant they had to upload the image somewhere else first.
          Uses the existing useUpload hook, the same one the video upload uses.
        */}
        {editingThumb && (
          <div className="px-5 pt-3">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleThumbFile(file);
              }}
              onClick={() => thumbInputRef.current?.click()}
              data-testid="dropzone-thumbnail"
              className={`rounded-xl border border-dashed p-6 text-center cursor-pointer transition-colors ${
                dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
            >
              <Upload className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">
                {thumbUploading ? "Uploading…" : "Drag and drop here"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">or choose from computer</p>
              <input
                ref={thumbInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                data-testid="input-thumbnail-file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleThumbFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        )}

        <SheetHeader className="px-5 pt-5 pb-1">
          <SheetTitle className="text-lg">Video Details</SheetTitle>
        </SheetHeader>

        <div className="px-5 pb-6 flex flex-col gap-5 flex-1">

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded-xl bg-muted/60 border border-border">
              <Eye className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-base font-bold">{views.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Views</p>
            </div>
            <div className="p-3 rounded-xl bg-muted/60 border border-border">
              <MousePointer className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-base font-bold">{clicks.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Clicks</p>
            </div>
            <div className="p-3 rounded-xl bg-muted/60 border border-border">
              <DollarSign className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-base font-bold">${revenue}</p>
              <p className="text-xs text-muted-foreground">Revenue</p>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="vid-title">Title</Label>
            <Input
              id="vid-title"
              data-testid="input-video-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="vid-desc">Description</Label>
            <Textarea
              id="vid-desc"
              data-testid="input-video-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe your video…"
            />
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Categories</Label>
              <span className="text-xs text-muted-foreground">Up to 3 selected</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => {
                const selected = categories.includes(cat.value);
                const maxed    = !selected && categories.length >= 3;
                return (
                  <button
                    key={cat.value}
                    data-testid={`toggle-category-${cat.value}`}
                    onClick={() => toggleCategory(cat.value)}
                    disabled={maxed}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all
                      ${selected ? cat.color + " ring-1 ring-current/30" : "bg-muted/50 text-muted-foreground border-border"}
                      ${maxed ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-80"}
                    `}
                  >
                    {selected ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Global Video Library listing — the $49 / 1-token flow */}
          <div className="space-y-3 border border-border rounded-xl p-4 bg-muted/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Library className="h-4 w-4 text-primary" />
                <Label className="text-sm font-semibold">Global Video Library</Label>
              </div>
              {isListed && (
                <Badge className="bg-green-600 hover:bg-green-600 text-white border-0 gap-1" data-testid="badge-video-listed">
                  <CheckCircle2 className="h-3 w-3" />
                  Listed
                </Badge>
              )}
            </div>

            {isListed ? (
              <p className="text-xs text-muted-foreground">
                This video is live in the Global Video Library — affiliates and publishers can license
                it. Nothing further to pay.
              </p>
            ) : TOKENS_TO_LIST === null ? (
              <p className="text-xs text-muted-foreground">
                Listing costs {CURRENCY_SYMBOL}{LICENSE_FEE}. This fee can't be settled in whole
                tokens, so it has to be paid by card.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Listing makes this video licensable by affiliates and publishers, who then drive
                  commission back to you. One-off fee of {CURRENCY_SYMBOL}{LICENSE_FEE}.
                </p>
                <TokenPayOption
                  required={TOKENS_TO_LIST}
                  usdAmount={LICENSE_FEE}
                  title="List with tokens"
                  breakdown={
                    existingListing
                      ? "This listing was created but never paid for — one token completes it."
                      : undefined
                  }
                  onPay={() => listWithTokensMutation.mutate()}
                  isPending={listWithTokensMutation.isPending}
                  testId="library-token-pay"
                >
                  {/* States the real product position instead of rendering a card
                      button that leads nowhere — nothing in the client consumes the
                      clientSecret that /api/library/list returns. */}
                  <p className="text-[11px] text-muted-foreground">
                    Card checkout for library listings isn't available in the app yet — tokens are the
                    self-serve option today.
                  </p>
                </TokenPayOption>
              </>
            )}
          </div>

          {/* ── Carousel styling for this video ──────────────────────────
              Beside the product links, because they are the two things you
              change about one video's carousel and she should not have to know
              they live in different places. The Brand Kit is still where the
              defaults are set; this is the per-video exception she asked for. */}
          <div className="space-y-3 border border-border rounded-xl p-4 bg-muted/30">
            <VideoCarouselOverride videoId={video.id} videoUrl={video.videoUrl} />
          </div>

          {/* Product Carousel Links */}
          <div className="space-y-3 border border-border rounded-xl p-4 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link className="h-4 w-4 text-primary" />
                <Label className="text-sm font-semibold">Product Carousel Links</Label>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setShowAddProduct((p) => !p)}
                data-testid="button-toggle-add-product"
              >
                <Plus className="h-3 w-3" />
                Add Link
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Add product URLs that will appear in the video carousel overlay.
            </p>

            {showAddProduct && (
              <div className="space-y-2 border border-border rounded-lg p-3 bg-background">
                <div className="space-y-1">
                  <Label className="text-xs">Product Name *</Label>
                  <Input
                    data-testid="input-product-name"
                    placeholder="e.g. Summer Dress"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Product URL *</Label>
                  <Input
                    data-testid="input-product-url"
                    placeholder="https://shop.example.com/product"
                    value={productUrl}
                    onChange={(e) => setProductUrl(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price (optional)</Label>
                  <Input
                    data-testid="input-product-price"
                    placeholder="e.g. 49.99"
                    value={productPrice}
                    onChange={(e) => setProductPrice(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={handleAddProduct}
                    disabled={!productName.trim() || !productUrl.trim() || addProductMutation.isPending}
                    data-testid="button-save-product-link"
                  >
                    {addProductMutation.isPending ? "Adding…" : "Add to Carousel"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setShowAddProduct(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {manualProducts.length > 0 ? (
              <div className="space-y-2">
                {manualProducts.map((p) => {
                  const name = p.product?.name ?? p.name ?? "";
                  const url  = p.product?.productUrl ?? p.product?.buyUrl ?? p.buyUrl ?? "";
                  const price = p.product?.price ?? p.price ?? null;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 p-2 rounded-lg bg-background border border-border"
                      data-testid={`product-link-${p.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{name}</p>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline truncate flex items-center gap-1"
                        >
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{url}</span>
                        </a>
                        {price && (
                          <Badge variant="secondary" className="text-xs mt-0.5 h-4">
                            ${price}
                          </Badge>
                        )}
                      </div>
                      <button
                        data-testid={`button-remove-product-${p.id}`}
                        onClick={() => removeProductMutation.mutate(p.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              !showAddProduct && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No product links yet. Click "Add Link" to get started.
                </p>
              )
            )}
          </div>

          {/* Product Timeline Overlays — shared with the upload flow, so the
              fields cannot drift between the two places that write these rows. */}
          {video && <OverlayComposer videoId={video.id} enabled={open} />}

          {/* Save */}
          <Button
            data-testid="button-save-video"
            onClick={handleSave}
            disabled={mutation.isPending || !title.trim()}
            className="w-full rounded-full mt-auto"
          >
            {mutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
