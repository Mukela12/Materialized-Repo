import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, Link2, Plus, RefreshCw, Code2, UploadCloud, X, AlertTriangle, ExternalLink, ImageIcon, Video } from "lucide-react";
import { SiShopify, SiWoocommerce, SiBigcommerce, SiMagento, SiGoogledrive, SiDropbox } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Product, Brand } from "@shared/schema";

const PLATFORMS = [
  { id: "shopify",     label: "Shopify",      placeholder: "shpat_xxxxxxxxxxxxxxxxxxxx",        Icon: SiShopify,     color: "#96bf48" },
  { id: "woocommerce", label: "WooCommerce",  placeholder: "ck_xxxxxxxxxxxxxxxxxxxxxxxx",       Icon: SiWoocommerce, color: "#7f54b3" },
  { id: "bigcommerce", label: "BigCommerce",  placeholder: "your BigCommerce API key",          Icon: SiBigcommerce, color: "#121118" },
  { id: "magento",     label: "Magento",      placeholder: "your Magento integration token",    Icon: SiMagento,     color: "#ee672f" },
  { id: "custom",      label: "Custom API",   placeholder: "your custom API key or token",      Icon: Code2,         color: "#677A67" },
] as const;

type PlatformId = (typeof PLATFORMS)[number]["id"];

const PRODUCT_TYPES = [
  "Physical Product",
  "Digital Product",
  "Service",
  "Subscription",
  "Bundle",
];

type ThumbSource = "computer" | "drive" | "dropbox";

function AddProductSheet({
  open,
  onClose,
  isApiConnected,
  brandId,
}: {
  open: boolean;
  onClose: () => void;
  isApiConnected: boolean;
  brandId?: string;
}) {
  const { toast } = useToast();

  // Form fields
  const [title, setTitle] = useState("");
  const [productType, setProductType] = useState("");
  const [price, setPrice] = useState("");
  const [posUrl, setPosUrl] = useState("");

  // Thumbnail
  const [thumbSource, setThumbSource] = useState<ThumbSource>("computer");
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle(""); setProductType(""); setPrice(""); setPosUrl("");
    setThumbSource("computer"); setThumbFile(null); setThumbPreview(null);
    setThumbUrl(""); setIsDragging(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const acceptFile = (file: File) => {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      toast({ title: "Unsupported file type", description: "Please upload an image or video file.", variant: "destructive" });
      return;
    }
    setThumbFile(file);
    setThumbPreview(URL.createObjectURL(file));
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) acceptFile(file);
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => {
      let imageUrl: string | undefined;

      // Upload thumbnail file if provided
      if (thumbSource === "computer" && thumbFile) {
        setIsUploading(true);
        try {
          const urlRes = await apiRequest("POST", "/api/uploads/request-url", {
            name: thumbFile.name,
            size: thumbFile.size,
            contentType: thumbFile.type,
          });
          const { uploadURL, objectPath } = await urlRes.json();
          await fetch(uploadURL, { method: "PUT", body: thumbFile, headers: { "Content-Type": thumbFile.type } });
          imageUrl = `/objects/${objectPath.replace(/^\//, "")}`;
        } finally {
          setIsUploading(false);
        }
      } else if ((thumbSource === "drive" || thumbSource === "dropbox") && thumbUrl.trim()) {
        imageUrl = thumbUrl.trim();
      }

      return apiRequest("POST", "/api/products", {
        name: title.trim(),
        price: parseFloat(price),
        productUrl: posUrl.trim() || undefined,
        productType: productType || undefined,
        imageUrl,
        thumbnailType: thumbFile?.type.startsWith("video/") ? "video" : "image",
        ...(brandId ? { brandId } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Product added", description: `"${title}" has been added to your inventory.` });
      handleClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to add product", description: err.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const canSubmit = title.trim() && price && parseFloat(price) > 0 && !createMutation.isPending && !isUploading;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto p-0"
        data-testid="sheet-add-product"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <SheetTitle className="text-foreground text-lg font-bold">Add Product</SheetTitle>
          <SheetDescription className="text-muted-foreground text-sm">
            Manually enter a product for a trial campaign.
          </SheetDescription>
        </SheetHeader>

        <div className="px-6 py-5 space-y-5">
          {/* API key warning */}
          {!isApiConnected && (
            <div className="bg-amber-500/8 border border-amber-500/25 rounded-2xl p-4 flex gap-3">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300 mb-0.5">API key required for live data</p>
                <p className="text-xs text-amber-300/70 leading-relaxed">
                  Manual entries are for <span className="font-medium text-amber-300">trial campaigns only</span>. To record sales metrics accurately and maintain real-time inventory stock levels, connect your platform API key in the section below.
                </p>
              </div>
            </div>
          )}

          {/* Product Title */}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs font-medium">Product Title *</Label>
            <Input
              data-testid="input-product-title"
              placeholder="e.g. Midnight Serum 30ml"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-xl"
            />
          </div>

          {/* Product Type */}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs font-medium">Product Type</Label>
            <Select value={productType} onValueChange={setProductType}>
              <SelectTrigger
                data-testid="select-product-type"
                className="rounded-xl"
              >
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {PRODUCT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Thumbnail */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs font-medium">Thumbnail</Label>

            {/* Source selector */}
            <div className="flex gap-2 mb-2">
              {(["computer", "drive", "dropbox"] as ThumbSource[]).map((src) => {
                const labels: Record<ThumbSource, React.ReactNode> = {
                  computer: <span className="flex items-center gap-1.5"><UploadCloud size={12} />Computer</span>,
                  drive: <span className="flex items-center gap-1.5"><SiGoogledrive size={12} />Drive</span>,
                  dropbox: <span className="flex items-center gap-1.5"><SiDropbox size={12} />Dropbox</span>,
                };
                return (
                  <button
                    key={src}
                    data-testid={`thumb-source-${src}`}
                    onClick={() => { setThumbSource(src); setThumbFile(null); setThumbPreview(null); setThumbUrl(""); }}
                    className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-all ${
                      thumbSource === src
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {labels[src]}
                  </button>
                );
              })}
            </div>

            {thumbSource === "computer" ? (
              thumbPreview ? (
                <div className="relative rounded-2xl overflow-hidden bg-muted/40 border border-border aspect-video">
                  {thumbFile?.type.startsWith("video/") ? (
                    <video src={thumbPreview} className="w-full h-full object-cover" muted playsInline controls />
                  ) : (
                    <img src={thumbPreview} alt="Preview" className="w-full h-full object-cover" />
                  )}
                  <button
                    onClick={() => { setThumbFile(null); setThumbPreview(null); }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80"
                    data-testid="button-remove-thumb"
                  >
                    <X size={14} className="text-white" />
                  </button>
                  <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full">
                    {thumbFile?.name}
                  </div>
                </div>
              ) : (
                <div
                  data-testid="dropzone-thumbnail"
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                    isDragging
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-border/80 hover:bg-muted/30"
                  }`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center">
                    <UploadCloud size={22} className="text-muted-foreground/60" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground/70">Drop image or video here</p>
                    <p className="text-xs text-muted-foreground mt-0.5">or click to browse your computer</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                      <ImageIcon size={9} /> JPG, PNG, WEBP
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                      <Video size={9} /> MP4, MOV
                    </span>
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
                  {thumbSource === "drive" ? (
                    <><SiGoogledrive size={13} className="text-[#4285F4]" />Paste a Google Drive share link</>
                  ) : (
                    <><SiDropbox size={13} className="text-[#0061FF]" />Paste a Dropbox share link</>
                  )}
                </div>
                <Input
                  data-testid={`input-thumb-url-${thumbSource}`}
                  placeholder={thumbSource === "drive" ? "https://drive.google.com/file/d/…" : "https://www.dropbox.com/s/…"}
                  value={thumbUrl}
                  onChange={(e) => setThumbUrl(e.target.value)}
                  className="rounded-xl text-sm"
                />
                {thumbUrl && (
                  <div className="flex items-center gap-2 text-[11px] text-primary">
                    <ExternalLink size={11} />
                    <span className="truncate">{thumbUrl}</span>
                  </div>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              data-testid="input-file-thumb"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); }}
            />
          </div>

          {/* Price */}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs font-medium">Product Price *</Label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">€</span>
              <Input
                data-testid="input-product-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="pl-7 rounded-xl"
              />
            </div>
          </div>

          {/* Product URL */}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs font-medium">Product URL <span className="text-primary">(Buy Now Link)</span></Label>
            <Input
              data-testid="input-product-pos-url"
              type="url"
              placeholder="https://yourstore.com/product/…"
              value={posUrl}
              onChange={(e) => setPosUrl(e.target.value)}
              className="rounded-xl"
            />
            <p className="text-[11px] text-muted-foreground">
              Viewers will be sent here when they tap this product in a video.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              data-testid="button-cancel-product"
              variant="outline"
              onClick={handleClose}
              className="flex-1 rounded-xl"
            >
              Cancel
            </Button>
            <Button
              data-testid="button-save-product"
              onClick={() => createMutation.mutate()}
              disabled={!canSubmit}
              className="flex-1 rounded-xl"
            >
              {createMutation.isPending || isUploading ? "Saving…" : "Add Product"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function BrandInventory() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId | null>(null);
  const [isApiConnected, setIsApiConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const { toast } = useToast();

  const activePlatform = PLATFORMS.find((p) => p.id === selectedPlatform);
  const inputPlaceholder = activePlatform
    ? `${activePlatform.label} API key — e.g. ${activePlatform.placeholder}`
    : "Select a platform above, then enter your API key";

  const { data: brands = [] } = useQuery<Brand[]>({
    queryKey: ["/api/brands"],
  });
  const currentBrandId = brands[0]?.id;

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const handleConnectApi = () => {
    if (selectedPlatform && apiKeyInput.trim()) {
      setIsApiConnected(true);
      toast({
        title: `${activePlatform?.label ?? "API"} Connected!`,
        description: "Your product inventory is now syncing automatically.",
      });
    }
  };

  const handleSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      toast({ title: "Sync Complete", description: "Your inventory has been updated." });
    }, 2000);
  };

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Product Inventory</h1>
          <p className="text-muted-foreground mt-1">Manage and sync your product catalog</p>
        </div>
        <div className="flex gap-2">
          {isApiConnected && (
            <Button
              variant="outline"
              onClick={handleSync}
              disabled={isSyncing}
              className="rounded-full gap-2"
              data-testid="button-sync-inventory"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Syncing..." : "Sync Now"}
            </Button>
          )}
          <Button
            className="rounded-full gap-2"
            data-testid="button-add-product"
            onClick={() => setAddProductOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add Product
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Connect Your Product API
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Sync your product inventory automatically with your e-commerce platform
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isApiConnected ? (
            <>
              <div className="space-y-2">
                <Label>Select your platform</Label>
                <div className="flex flex-wrap gap-3">
                  {PLATFORMS.map((p) => {
                    const isSelected = selectedPlatform === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPlatform(p.id)}
                        data-testid={`button-platform-${p.id}`}
                        title={p.label}
                        className={`flex flex-col items-center gap-1.5 w-28 py-2.5 px-1 rounded-xl border-2 transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border bg-card hover:border-muted-foreground/40 hover:bg-muted/50"
                        }`}
                      >
                        <p.Icon
                          style={{ color: isSelected ? p.color : undefined }}
                          className={`h-7 w-7 transition-colors ${!isSelected ? "text-muted-foreground" : ""}`}
                        />
                        <span className={`text-[10px] font-medium leading-tight text-center ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                          {p.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder={inputPlaceholder}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  disabled={!selectedPlatform}
                  data-testid="input-inventory-api-key"
                />
              </div>
              <Button
                onClick={handleConnectApi}
                className="rounded-full"
                disabled={!selectedPlatform || !apiKeyInput.trim()}
                data-testid="button-connect-inventory-api"
              >
                Connect {activePlatform?.label ?? "API"}
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
              <div className="h-3 w-3 bg-green-500 rounded-full animate-pulse" />
              <div>
                <p className="font-medium text-green-700 dark:text-green-400">API Connected</p>
                <p className="text-sm text-green-600 dark:text-green-500">Your inventory is syncing automatically</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5" />
            Product Catalog
          </CardTitle>
          <p className="text-sm text-muted-foreground">{products.length} products in inventory</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : products.length > 0 ? (
            <div className="grid gap-4">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center gap-4 p-4 border rounded-lg hover-elevate cursor-pointer"
                  data-testid={`product-card-${product.id}`}
                >
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-16 w-16 object-cover rounded-md"
                    />
                  ) : (
                    <div className="h-16 w-16 bg-muted rounded-md flex items-center justify-center">
                      <Package className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{product.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{product.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-semibold text-primary">€{product.price}</span>
                      {(product as any).productType && (
                        <Badge variant="outline" className="text-xs">{(product as any).productType}</Badge>
                      )}
                      {product.category && (
                        <Badge variant="secondary" className="text-xs">{product.category}</Badge>
                      )}
                    </div>
                    {product.productUrl && (
                      <a
                        href={product.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-1 w-fit"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={10} />
                        View in store
                      </a>
                    )}
                  </div>
                  <Button variant="outline" size="sm" className="rounded-full">
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No products in inventory</p>
              <p className="text-sm mb-4">Connect your API or add products manually</p>
              <Button
                className="rounded-full gap-2"
                onClick={() => setAddProductOpen(true)}
                data-testid="button-add-first-product"
              >
                <Plus className="h-4 w-4" />
                Add Your First Product
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AddProductSheet
        open={addProductOpen}
        onClose={() => setAddProductOpen(false)}
        isApiConnected={isApiConnected}
        brandId={currentBrandId}
      />
    </div>
  );
}
