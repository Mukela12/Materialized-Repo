import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/StatCard";
import { BrandDashboardTabs } from "@/components/BrandDashboardTabs";
import { VideoUploadModal } from "@/components/VideoUploadModal";
import { defaultCarouselSettings } from "@/components/ProductCarouselEditor";
import { Eye, DollarSign, MousePointer, Users, Package, Link2, TrendingUp, Zap, Mail, Settings, Upload, Calculator } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import type { Brand, User, Product } from "@shared/schema";
import { OVERAGE_RATES } from "@shared/plans";
import { CURRENCY_SYMBOL } from "@/lib/currency";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const connectCreatorSchema = z.object({
  creatorName: z.string().min(1, "Creator name is required"),
  creatorEmail: z.string().email("Valid email is required"),
  contentCategory: z.string().optional(),
  message: z.string().optional(),
});

type ConnectCreatorForm = z.infer<typeof connectCreatorSchema>;

export default function BrandDashboard() {
  const [activeTab, setActiveTab] = useState("stats");
  const [, navigate] = useLocation();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const { toast } = useToast();

  const { data: currentUser } = useQuery<User>({
    queryKey: ["/api/users/me"],
  });

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    // Own inventory only — unscoped, this endpoint answers "whose products may
    // I browse", which on a Brand's own catalogue page means the marketplace.
    queryKey: ["/api/products", "mine"],
    queryFn: () => fetch("/api/products?mine=true", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: brands = [] } = useQuery<Brand[]>({
    queryKey: ["/api/brands"],
  });

  const { data: stats } = useQuery<{
    totalViews: number;
    totalClicks: number;
    totalConversions: number;
    totalRevenue: number;
    activeCreators: number;
  }>({
    queryKey: ["/api/brands/stats"],
  });

  const form = useForm<ConnectCreatorForm>({
    resolver: zodResolver(connectCreatorSchema),
    defaultValues: {
      creatorName: "",
      creatorEmail: "",
      contentCategory: "",
      message: "",
    },
  });

  const creatorInviteMutation = useMutation({
    mutationFn: async (data: ConnectCreatorForm) => {
      return apiRequest("POST", "/api/brands/invite-creator", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brands/creator-invites"] });
      toast({
        title: "Invitation Sent!",
        description: "Your invitation email has been sent to the creator.",
      });
      form.reset();
    },
    onError: () => {
      toast({
        title: "Invitation Failed",
        description: "There was an error sending the invitation.",
        variant: "destructive",
      });
    },
  });

  const onSubmitCreatorInvite = (data: ConnectCreatorForm) => {
    creatorInviteMutation.mutate(data);
  };

  const videoMutation = useMutation({
    mutationFn: async (data: { title: string; description?: string; videoUrl: string; brandIds: string[] }) => {
      return apiRequest("POST", "/api/videos", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      toast({ title: "Video Published!", description: "Your video is now being processed for product detection." });
    },
    onError: () => {
      toast({ title: "Upload Failed", description: "There was an error uploading your video.", variant: "destructive" });
    },
  });

  const referralMutation = useMutation({
    mutationFn: async (data: { brandName: string; prContactName: string; prContactEmail: string; productCategory?: string; message?: string }) => {
      return apiRequest("POST", "/api/brand-referrals", data);
    },
    onSuccess: () => {
      toast({ title: "Brand Tagged!", description: "We'll let you know when they activate your video." });
    },
  });

  const handleVideoUpload = async (data: {
    title: string;
    description?: string;
    videoUrl: string;
    selectedBrands: string[];
  }) => {
    await videoMutation.mutateAsync({
      title: data.title,
      description: data.description,
      videoUrl: data.videoUrl,
      brandIds: data.selectedBrands,
    });
  };

  const handleReferBrand = async (data: {
    brandName: string;
    prContactName: string;
    prContactEmail: string;
    productCategory?: string;
    message?: string;
  }) => {
    await referralMutation.mutateAsync(data);
  };

  const brandStats = stats || {
    totalViews: 0,
    totalClicks: 0,
    totalConversions: 0,
    totalRevenue: 0,
    activeCreators: 0,
  };

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Brand Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Manage your products and connect with creators
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button
            onClick={() => setUploadModalOpen(true)}
            className="rounded-full gap-2 flex-1 sm:flex-none"
            data-testid="button-upload-video"
          >
            <Upload className="h-4 w-4" />
            Upload Video
          </Button>
          <Button
            variant="outline"
            className="rounded-full gap-2 flex-1 sm:flex-none"
            data-testid="button-add-product"
            onClick={() => navigate("/brand/inventory")}
          >
            <Package className="h-4 w-4" />
            Add Product
          </Button>
        </div>
      </div>

      <BrandDashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "stats" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">Brand Performance</CardTitle>
            <p className="text-sm text-muted-foreground">
              Your products across all creator videos
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div data-testid="stat-brand-views">
                <StatCard
                  title="Total Views"
                  value={brandStats.totalViews.toLocaleString()}
                  subtitle="Product impressions"
                  icon={Eye}
                />
              </div>
              <div data-testid="stat-brand-clicks">
                <StatCard
                  title="Total Clicks"
                  value={brandStats.totalClicks.toLocaleString()}
                  subtitle="Product clicks"
                  icon={MousePointer}
                />
              </div>
              <div data-testid="stat-brand-conversions">
                <StatCard
                  title="Conversions"
                  value={brandStats.totalConversions}
                  subtitle="Purchases made"
                  icon={TrendingUp}
                />
              </div>
              <div data-testid="stat-brand-revenue">
                <StatCard
                  title="Revenue Generated"
                  value={`$${brandStats.totalRevenue.toLocaleString()}`}
                  subtitle="From creator sales"
                  icon={DollarSign}
                />
              </div>
              <div data-testid="stat-brand-creators">
                <StatCard
                  title="Active Creators"
                  value={brandStats.activeCreators}
                  subtitle="Featuring your products"
                  icon={Users}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "stats" && (
        /*
          The "Surplus Pricing Calculator" that lived here quoted $0.008/min with
          minutes derived as views x publishers. That is not the pricing model —
          the client confirmed $0.05/view + $0.15/min on 29 Jul 2026 — and it made
          the product quote two different prices on two different screens: on
          10,000 views across 10 publishers, $800 here versus $5,000 on the
          settings page.

          It is not converted in place because its whole premise was the wrong
          formula and it has no minutes input to salvage. The correct estimator,
          reading the shared OVERAGE_RATES, is on the subscription settings page.
        */
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Estimate overage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {/*
                toFixed(3) on the view rate, not (2). At $0.005 a two-decimal
                render says "$0.01" — double the real price, on a screen whose
                whole job is telling someone what they will be charged.
                "across your publishers" is also gone: each account now carries
                its own allowance and its own overage.
              */}
              Estimate what your views and uploaded minutes would cost,
              at {CURRENCY_SYMBOL}{OVERAGE_RATES.perView.toFixed(3)} per view and{" "}
              {CURRENCY_SYMBOL}{OVERAGE_RATES.perMinute.toFixed(2)} per minute.
            </p>
            <Link href="/brand/settings/subscription">
              <Button variant="outline" className="rounded-full" data-testid="button-open-overage-estimator">
                Open the estimator
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {activeTab === "inventory" && (
        <div className="space-y-6">
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
            {/*
              This used to be a non-functional mock: a single "API Key" field whose
              Connect button called no endpoint at all — it flipped local state and
              showed "API Connected! Your product inventory is now syncing", which
              was never true. A brand following it would believe their catalogue was
              live while nothing had been imported.

              The working integration lives at /brand/inventory, which collects the
              credentials each platform actually needs (Shopify wants a store domain
              AND an Admin API token, WooCommerce a URL plus consumer key/secret —
              none of which fit in one generic field), validates them against the
              live store before saving, and then runs a real product sync.
            */}
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Shopify</Badge>
                <Badge variant="outline">WooCommerce</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Connect your store to import your products. You'll need your store
                address and an API credential from your platform — the next page
                walks through where to find them.
              </p>
              <Link href="/brand/inventory">
                <Button className="rounded-full" data-testid="button-connect-api">
                  Connect your store
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Package className="h-5 w-5" />
                Product Inventory
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {products.length} products synced
              </p>
            </CardHeader>
            <CardContent>
              {productsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : products.length > 0 ? (
                <div className="space-y-3">
                  {products.map((product) => (
                    <div 
                      key={product.id} 
                      className="flex items-center gap-4 p-3 border rounded-lg"
                      data-testid={`product-item-${product.id}`}
                    >
                      {product.imageUrl && (
                        <img 
                          src={product.imageUrl} 
                          alt={product.name}
                          className="h-12 w-12 object-cover rounded-md"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{product.name}</p>
                        <p className="text-sm text-muted-foreground">${product.price}</p>
                      </div>
                      <Badge variant="secondary">{product.category}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                  <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                    <Package className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground/70">No products synced yet</p>
                  <p className="text-xs mt-1">Connect your API to import your inventory</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "creators" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Connect Your Creators
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Invite content creators to feature your products in their videos
              </p>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitCreatorInvite)} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="creatorName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Creator Name</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Enter creator's name" 
                              {...field}
                              data-testid="input-creator-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="creatorEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Creator Email</FormLabel>
                          <FormControl>
                            <Input 
                              type="email"
                              placeholder="creator@example.com" 
                              {...field}
                              data-testid="input-creator-email"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="contentCategory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Content Category (Optional)</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g., Fashion, Tech, Beauty" 
                            {...field}
                            data-testid="input-content-category"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="message"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Personal Message (Optional)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Add a personal note to your invitation..."
                            className="resize-none"
                            {...field}
                            data-testid="input-invitation-message"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button 
                    type="submit" 
                    className="rounded-full gap-2"
                    disabled={creatorInviteMutation.isPending}
                    data-testid="button-send-invitation"
                  >
                    <Mail className="h-4 w-4" />
                    {creatorInviteMutation.isPending ? "Sending..." : "Send Invitation"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Connected Creators</CardTitle>
              <p className="text-sm text-muted-foreground">
                Creators currently featuring your products
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                  <Users className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground/70">No creators connected yet</p>
                <p className="text-xs mt-1">Send invitations to start building your creator network</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "performance" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Performance Analytics</CardTitle>
            <p className="text-sm text-muted-foreground">
              Track how your products perform across creator videos and publishing sources
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <TrendingUp className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground/70">View full performance analytics and embed traces</p>
              <p className="text-xs mt-1 mb-4">See viewing trends, peak hours, and per-source performance</p>
              <Link href="/brand/analytics">
                <Button className="rounded-full gap-2" data-testid="button-view-analytics">
                  <TrendingUp className="h-4 w-4" />
                  Open Full Analytics
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "quick-actions" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/brand/inventory")}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Add New Product</h3>
                  <p className="text-sm text-muted-foreground">Manually add a product to your inventory</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/brand/creators")}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Invite Creator</h3>
                  <p className="text-sm text-muted-foreground">Send an invitation to a content creator</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/brand/inventory")}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Link2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Connect API</h3>
                  <p className="text-sm text-muted-foreground">Sync your e-commerce inventory</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/brand/settings")}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Settings className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Brand Settings</h3>
                  <p className="text-sm text-muted-foreground">Configure your brand profile</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "campaigns" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Marketing Campaigns</CardTitle>
            <p className="text-sm text-muted-foreground">
              Create and manage promotional campaigns with creators
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Zap className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground/70">No active campaigns</p>
              <p className="text-xs mt-1">Create your first campaign to boost product visibility</p>
              <Button className="rounded-full mt-4" data-testid="button-create-campaign" onClick={() => navigate("/brand/campaigns/new")}>
                Create Campaign
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <VideoUploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        brands={brands}
        onUpload={handleVideoUpload}
        onReferBrand={handleReferBrand}
      />
    </div>
  );
}
