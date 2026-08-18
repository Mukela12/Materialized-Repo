import { CURRENCY_SYMBOL } from "@/lib/currency";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Package, Link2, Plus, RefreshCw, Code2, UploadCloud, X, AlertTriangle, ExternalLink, ImageIcon, Video, Trash2 } from "lucide-react";
import { SiShopify, SiWoocommerce, SiBigcommerce, SiMagento, SiGoogledrive, SiDropbox } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
import type { Product, Brand } from "@shared/schema";
import { useTableControls, type SortDir } from "@/hooks/useTableControls";
import { exportToCsv } from "@/lib/exportCsv";
import { TableToolbar } from "@/components/TableToolbar";
import { ArrowDownUp } from "lucide-react";
import { videoDeliveryUrl } from "@shared/videoDelivery";

const PLATFORMS = [
  { id: "shopify",     label: "Shopify",      placeholder: "shpat_xxxxxxxxxxxxxxxxxxxx",        Icon: SiShopify,     color: "#96bf48", supported: true  },
  { id: "woocommerce", label: "WooCommerce",  placeholder: "ck_xxxxxxxxxxxxxxxxxxxxxxxx",       Icon: SiWoocommerce, color: "#7f54b3", supported: true  },
  { id: "bigcommerce", label: "BigCommerce",  placeholder: "your BigCommerce API key",          Icon: SiBigcommerce, color: "#121118", supported: false },
  { id: "magento",     label: "Magento",      placeholder: "your Magento integration token",    Icon: SiMagento,     color: "#ee672f", supported: false },
  { id: "custom",      label: "Custom API",   placeholder: "your custom API key or token",      Icon: Code2,         color: "#1351aa", supported: false },
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
  product,
}: {
  open: boolean;
  onClose: () => void;
  isApiConnected: boolean;
  brandId?: string;
  product?: Product;
}) {
  const { toast } = useToast();
  const { uploadFile } = useUpload();

  const isEdit = !!product;

  // Form fields — seeded from the product when editing (the call site keys this
  // component by product id, so these initializers run fresh per product).
  const [title, setTitle] = useState(product?.name ?? "");
  const [productType, setProductType] = useState((product as any)?.productType ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [posUrl, setPosUrl] = useState(product?.productUrl ?? "");

  // Thumbnail
  const [thumbSource, setThumbSource] = useState<ThumbSource>("computer");
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(product?.imageUrl ?? null);
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
          const { objectUrl } = await uploadFile(thumbFile);
          imageUrl = objectUrl;
        } finally {
          setIsUploading(false);
        }
      } else if ((thumbSource === "drive" || thumbSource === "dropbox") && thumbUrl.trim()) {
        imageUrl = thumbUrl.trim();
      }

      if (isEdit) {
        // On edit, only send imageUrl when a new one was actually provided so the
        // existing thumbnail isn't wiped. brandId is not editable and is omitted.
        return apiRequest("PATCH", `/api/products/${product!.id}`, {
          name: title.trim(),
          price: parseFloat(price),
          productUrl: posUrl.trim() || undefined,
          productType: productType || undefined,
          ...(imageUrl ? { imageUrl } : {}),
        });
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
      toast({
        title: isEdit ? "Product updated" : "Product added",
        description: isEdit
          ? `"${title}" has been updated.`
          : `"${title}" has been added to your inventory.`,
      });
      handleClose();
    },
    onError: (err: any) => {
      toast({
        title: isEdit ? "Failed to update product" : "Failed to add product",
        description: err.message ?? "Please try again.",
        variant: "destructive",
      });
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
          <SheetTitle className="text-foreground text-lg font-bold">{isEdit ? "Edit Product" : "Add Product"}</SheetTitle>
          <SheetDescription className="text-muted-foreground text-sm">
            {isEdit ? "Update the details for this product." : "Manually enter a product for a trial campaign."}
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
                    <video src={videoDeliveryUrl(thumbPreview, "preview")} className="w-full h-full object-cover" muted playsInline controls />
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
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">{CURRENCY_SYMBOL}</span>
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
              {createMutation.isPending || isUploading ? "Saving…" : isEdit ? "Save Changes" : "Add Product"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface StoreConnection {
  id: string;
  platform: string;
  storeDomain: string | null;
  lastSyncAt: string | null;
  productCount: number;
  isActive: boolean;
  hasWebhookSecret?: boolean;
  webhookUrl?: string | null;
}

export default function BrandInventory() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [storeUrlInput, setStoreUrlInput] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [shopifyWebhookSecretInput, setShopifyWebhookSecretInput] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId | null>(null);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  // One-time webhook setup details returned by the connect call (URL + secret to paste).
  const [webhookSetup, setWebhookSetup] = useState<
    { status: string; url: string; secret: string; error?: string } | null
  >(null);
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

  const { query, setQuery, sortKey, sortDir, toggleSort, rows: productRows } = useTableControls(products, {
    searchFields: (p) => [
      p.name,
      p.description,
      p.sku,
      p.category,
      (p as any).productType,
    ],
    initialSort: { key: "name", dir: "asc" },
    sortAccessors: {
      name: (p) => p.name,
      price: (p) => p.price,
      category: (p) => p.category,
      productType: (p) => (p as any).productType,
    },
  });

  const handleExportProducts = () =>
    exportToCsv("products", productRows, [
      { header: "Name", value: (p) => p.name },
      { header: "SKU", value: (p) => p.sku },
      { header: "Price", value: (p) => p.price },
      { header: "Category", value: (p) => p.category },
      { header: "Type", value: (p) => (p as any).productType },
      { header: "Active", value: (p) => (p.isActive ? "yes" : "no") },
      { header: "Product URL", value: (p) => p.productUrl },
    ]);

  const { data: storeConnections = [] } = useQuery<StoreConnection[]>({
    queryKey: ["/api/integrations/stores"],
  });

  const isApiConnected = storeConnections.length > 0;
  const activeConnection = storeConnections.find(c => c.isActive);

  const connectMutation = useMutation({
    mutationFn: async () => {
      if (selectedPlatform === "shopify") {
        return apiRequest("POST", "/api/integrations/shopify/connect", {
          storeDomain: storeUrlInput || apiKeyInput.split("@")[1] || "",
          accessToken: apiKeyInput,
          webhookSecret: shopifyWebhookSecretInput || undefined,
        });
      } else if (selectedPlatform === "woocommerce") {
        return apiRequest("POST", "/api/integrations/woocommerce/connect", {
          storeUrl: storeUrlInput,
          consumerKey: apiKeyInput,
          consumerSecret: secretInput,
        });
      }
      throw new Error(`${activePlatform?.label ?? "This platform"} isn't supported yet — coming soon.`);
    },
    onSuccess: async (res) => {
      const data = await res.json().catch(() => ({}));
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/stores"] });
      // Surface the receiver URL + one-time secret so the brand can finish setup
      // manually if auto-registration wasn't possible (Shopify token flow, API blocked).
      if (data?.webhookRegistration) setWebhookSetup(data.webhookRegistration);
      toast({
        title: `${activePlatform?.label ?? "Store"} Connected!`,
        description: data?.webhookRegistration?.status === "registered"
          ? "Verified-sales webhook registered. Your inventory is ready to sync."
          : "Store connected. Finish webhook setup below to enable verified sales.",
      });
      setApiKeyInput("");
      setStoreUrlInput("");
      setSecretInput("");
      setShopifyWebhookSecretInput("");
    },
    onError: (err: any) => {
      toast({
        title: "Connection Failed",
        description: err?.message || "Could not connect to your store. Check your credentials.",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection) throw new Error("No store connected");
      return apiRequest("POST", `/api/integrations/stores/${activeConnection.id}/sync`);
    },
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/stores"] });
      toast({
        title: "Sync Complete",
        description: `Imported ${data.synced} products from your store.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Sync Failed",
        description: err?.message || "Could not sync products.",
        variant: "destructive",
      });
    },
  });

  const testWebhookMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection) throw new Error("No store connected");
      return apiRequest("POST", `/api/integrations/stores/${activeConnection.id}/webhook-test`);
    },
    onSuccess: async (res) => {
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        toast({ title: "Webhook verified", description: "The receiver accepted a signed test order." });
      } else {
        toast({
          title: "Webhook test failed",
          description: data?.receiver?.error || `Receiver responded ${data?.status ?? "?"}.`,
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Webhook test failed", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const reRegisterMutation = useMutation({
    mutationFn: async () => {
      if (!activeConnection) throw new Error("No store connected");
      return apiRequest("POST", `/api/integrations/stores/${activeConnection.id}/register-webhook`);
    },
    onSuccess: async (res) => {
      const data = await res.json().catch(() => ({}));
      setWebhookSetup(data);
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/stores"] });
      toast({
        title: data?.status === "registered" ? "Webhook re-registered" : "Manual setup required",
        description: data?.status === "registered"
          ? "The verified-sales webhook is active."
          : "We couldn't auto-register. Use the URL + secret below to set it up manually.",
        variant: data?.status === "registered" ? undefined : "destructive",
      });
    },
    onError: (err: any) => {
      toast({ title: "Re-register failed", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Product deleted" });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to delete product",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleDeleteProduct = (product: Product) => {
    setProductToDelete(product);
  };

  const confirmDeleteProduct = () => {
    if (productToDelete) {
      deleteMutation.mutate(productToDelete.id);
      setProductToDelete(null);
    }
  };

  const handleConnectApi = () => {
    if (selectedPlatform && apiKeyInput.trim()) {
      connectMutation.mutate();
    }
  };

  const isSyncing = syncMutation.isPending;
  const handleSync = () => syncMutation.mutate();

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
                        onClick={() => p.supported && setSelectedPlatform(p.id)}
                        disabled={!p.supported}
                        aria-disabled={!p.supported}
                        data-testid={`button-platform-${p.id}`}
                        title={p.supported ? p.label : `${p.label} — coming soon`}
                        className={`relative flex flex-col items-center gap-1.5 w-28 py-2.5 px-1 rounded-xl border-2 transition-all ${
                          !p.supported
                            ? "border-border bg-card opacity-50 cursor-not-allowed"
                            : isSelected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border bg-card hover:border-muted-foreground/40 hover:bg-muted/50"
                        }`}
                      >
                        {!p.supported && (
                          <Badge
                            variant="secondary"
                            className="absolute -top-2 -right-2 px-1.5 py-0 text-[9px] font-medium leading-tight pointer-events-none"
                            data-testid={`badge-coming-soon-${p.id}`}
                          >
                            Soon
                          </Badge>
                        )}
                        <p.Icon
                          style={{ color: p.supported ? (isSelected ? p.color : undefined) : p.color }}
                          className={`h-7 w-7 transition-colors ${p.supported && !isSelected ? "text-muted-foreground" : ""}`}
                        />
                        <span className={`text-[10px] font-medium leading-tight text-center ${isSelected && p.supported ? "text-foreground" : "text-muted-foreground"}`}>
                          {p.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="store-url">Store URL</Label>
                <Input
                  id="store-url"
                  placeholder={selectedPlatform === "shopify" ? "mystore.myshopify.com" : "mystore.com"}
                  value={storeUrlInput}
                  onChange={(e) => setStoreUrlInput(e.target.value)}
                  disabled={!selectedPlatform}
                  data-testid="input-store-url"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-key">{selectedPlatform === "woocommerce" ? "Consumer Key" : "Access Token / API Key"}</Label>
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
              {selectedPlatform === "woocommerce" && (
                <div className="space-y-2">
                  <Label htmlFor="consumer-secret">Consumer Secret</Label>
                  <Input
                    id="consumer-secret"
                    type="password"
                    placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxx"
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    data-testid="input-consumer-secret"
                  />
                </div>
              )}
              {selectedPlatform === "shopify" && (
                <div className="space-y-2">
                  <Label htmlFor="shopify-webhook-secret">Webhook Signing Secret (optional)</Label>
                  <Input
                    id="shopify-webhook-secret"
                    type="password"
                    placeholder="Your Shopify app's API secret key"
                    value={shopifyWebhookSecretInput}
                    onChange={(e) => setShopifyWebhookSecretInput(e.target.value)}
                    data-testid="input-shopify-webhook-secret"
                  />
                  <p className="text-xs text-muted-foreground">
                    Shopify signs order webhooks with your app's API secret key. Paste it to enable
                    verified-sales commissions. Leave blank to use the platform default.
                  </p>
                </div>
              )}
              <Button
                onClick={handleConnectApi}
                className="rounded-full"
                disabled={!selectedPlatform || !apiKeyInput.trim() || !storeUrlInput.trim() || connectMutation.isPending}
                data-testid="button-connect-inventory-api"
              >
                {connectMutation.isPending ? "Connecting..." : `Connect ${activePlatform?.label ?? "API"}`}
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 bg-green-500 rounded-full animate-pulse" />
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400">
                      {activeConnection?.platform === "shopify" ? "Shopify" : activeConnection?.platform === "woocommerce" ? "WooCommerce" : "Store"} Connected
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-500">
                      {activeConnection?.storeDomain || "Store connected"} — {activeConnection?.productCount ?? 0} products
                      {activeConnection?.lastSyncAt && ` — Last synced ${new Date(activeConnection.lastSyncAt).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
              </div>

              {activeConnection?.webhookUrl && (
                <div className="p-4 border rounded-lg space-y-3" data-testid="webhook-settings">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Code2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">Verified-Sales Webhook</span>
                      <Badge variant={activeConnection.hasWebhookSecret ? "secondary" : "outline"} className="text-xs">
                        {activeConnection.hasWebhookSecret ? "Secret set" : "No secret"}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => testWebhookMutation.mutate()}
                        disabled={testWebhookMutation.isPending || !activeConnection.hasWebhookSecret}
                        data-testid="button-test-webhook"
                      >
                        {testWebhookMutation.isPending ? "Testing..." : "Test webhook"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => reRegisterMutation.mutate()}
                        disabled={reRegisterMutation.isPending}
                        data-testid="button-reregister-webhook"
                      >
                        {reRegisterMutation.isPending ? "Registering..." : "Re-register"}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Receiver URL (orders/create)</Label>
                    <code className="block text-xs bg-muted rounded px-2 py-1.5 break-all" data-testid="text-webhook-url">
                      {activeConnection.webhookUrl}
                    </code>
                  </div>
                  {!activeConnection.hasWebhookSecret && (
                    <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      No signing secret is set for this connection — verified-sales commissions won't be recorded until one is configured.
                    </p>
                  )}
                </div>
              )}

              {webhookSetup && (
                <div className="p-4 border rounded-lg space-y-3 bg-muted/40" data-testid="webhook-setup-details">
                  <p className="text-sm font-medium">
                    {webhookSetup.status === "registered"
                      ? "Webhook registered automatically."
                      : "Manual webhook setup — copy these into your store once."}
                  </p>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Receiver URL</Label>
                    <code className="block text-xs bg-background border rounded px-2 py-1.5 break-all">
                      {webhookSetup.url}
                    </code>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Signing secret (shown once)</Label>
                    <code className="block text-xs bg-background border rounded px-2 py-1.5 break-all" data-testid="text-webhook-secret">
                      {webhookSetup.secret || "(uses platform default secret)"}
                    </code>
                  </div>
                  {webhookSetup.error && (
                    <p className="text-xs text-muted-foreground">Auto-registration note: {webhookSetup.error}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Package className="h-5 w-5" />
                Product Catalog
              </CardTitle>
              <p className="text-sm text-muted-foreground">{products.length} products in inventory</p>
            </div>
            {products.length > 0 && (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Select
                  value={sortKey ?? "name"}
                  onValueChange={(v) => { if (v !== sortKey) toggleSort(v); }}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-product-sort">
                    <div className="flex items-center gap-2">
                      <ArrowDownUp className="h-3.5 w-3.5" />
                      <SelectValue placeholder="Sort by" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="price">Price</SelectItem>
                    <SelectItem value="category">Category</SelectItem>
                    <SelectItem value="productType">Type</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => sortKey && toggleSort(sortKey)}
                  data-testid="button-product-sort-dir"
                  title={sortDir === "asc" ? "Ascending" : "Descending"}
                >
                  <ArrowDownUp className={`h-4 w-4 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} />
                </Button>
                <TableToolbar
                  query={query}
                  onQueryChange={setQuery}
                  onExport={handleExportProducts}
                  exportDisabled={productRows.length === 0}
                  searchPlaceholder="Search products…"
                  data-testid="products-toolbar"
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : productRows.length > 0 ? (
            <div className="grid gap-4">
              {productRows.map((product) => (
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
                      <span className="font-semibold text-primary">{CURRENCY_SYMBOL}{product.price}</span>
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
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => setEditingProduct(product)}
                      data-testid={`button-edit-product-${product.id}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteProduct(product)}
                      disabled={deleteMutation.isPending && deleteMutation.variables === product.id}
                      data-testid={`button-delete-product-${product.id}`}
                      title="Delete product"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : products.length > 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="products-no-match">
              <Package className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No products match your search</p>
              <p className="text-sm">Try a different search term</p>
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
        key={editingProduct?.id ?? "new"}
        open={addProductOpen || !!editingProduct}
        onClose={() => { setAddProductOpen(false); setEditingProduct(null); }}
        isApiConnected={isApiConnected}
        brandId={currentBrandId}
        product={editingProduct ?? undefined}
      />

      <AlertDialog
        open={!!productToDelete}
        onOpenChange={(o) => { if (!o) setProductToDelete(null); }}
      >
        <AlertDialogContent data-testid="dialog-delete-product">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              {productToDelete
                ? `"${productToDelete.name}" will be permanently removed. This cannot be undone.`
                : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-product">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground border border-destructive-border"
              onClick={confirmDeleteProduct}
              data-testid="button-confirm-delete-product"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
