import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/StatCard";
import { greeting, todayLabel, monthToDateLabel } from "@/lib/greeting";
import { AffiliateCard } from "@/components/AffiliateCard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { AffiliateTable } from "@/components/AffiliateTable";
import { VideoUploadModal } from "@/components/VideoUploadModal";
import { CreatorRewardNotification } from "@/components/EarningsNotification";
import { Eye, DollarSign, MousePointer, Upload, Play, TrendingUp, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import type { Video, Brand, User } from "@shared/schema";
import type { MonthStats } from "@shared/monthStats";
import { formatStatMoney } from "@/lib/currency";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("stats");
  const [, navigate] = useLocation();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [demoEarnings, setDemoEarnings] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDemoEarnings(1500);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const { data: currentUser } = useQuery<User>({
    queryKey: ["/api/users/me"],
  });

  const { data: videos = [], isLoading: videosLoading } = useQuery<Video[]>({
    queryKey: ["/api/videos"],
  });

  const { data: brands = [] } = useQuery<Brand[]>({
    queryKey: ["/api/brands"],
  });

  // Month to date, from real orders and this creator's own events. The
  // lifetime /api/analytics/stats is not what a "This month" heading promises.
  const { data: stats } = useQuery<MonthStats>({
    queryKey: ["/api/analytics/month"],
  });

  const videoMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description?: string;
      videoUrl: string;
      brandIds: string[];
    }) => {
      return apiRequest("POST", "/api/videos", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/month"] });
      toast({
        title: "Video Published!",
        description: "Your video is now being processed for product detection.",
      });
    },
    onError: () => {
      toast({
        title: "Upload Failed",
        description: "There was an error uploading your video.",
        variant: "destructive",
      });
    },
  });

  const referralMutation = useMutation({
    mutationFn: async (data: {
      brandName: string;
      prContactName: string;
      prContactEmail: string;
      productCategory?: string;
      message?: string;
    }) => {
      return apiRequest("POST", "/api/referrals", data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals"] });
      toast({
        title: "Referral Sent!",
        description: `We've sent an invitation to ${variables.brandName}.`,
      });
    },
    onError: () => {
      toast({
        title: "Referral Failed",
        description: "There was an error sending the referral.",
        variant: "destructive",
      });
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

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <CreatorRewardNotification />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{todayLabel()}</p>
          <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">{greeting(currentUser?.displayName)}</h1>
        </div>
        <Button 
          onClick={() => setUploadModalOpen(true)} 
          className="rounded-full gap-2 w-full sm:w-auto"
          data-testid="button-upload-video"
        >
          <Upload className="h-4 w-4" />
          Upload Video
        </Button>
      </div>

      <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "stats" && (
        // A section, not a card holding cards: a quiet heading with the window
        // the numbers cover, then one framed panel. The money metric leads.
        <section className="space-y-3" aria-labelledby="stats-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="stats-heading" className="text-base font-semibold tracking-tight">This month</h2>
            <span className="text-xs text-muted-foreground tabular-nums">{monthToDateLabel()}</span>
          </div>
          <div className="stat-panel grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {/* Gross sales the creator's videos drove — NOT a Materialized
                balance. The platform creator commission rate is 0 by default
                (brands pay creators directly), so this must never be labelled
                "Revenue" or "Earnings". See server/feeConfig.ts. */}
            <StatCard
              hero
              className="col-span-2 sm:col-span-3 lg:col-span-2"
              title="Attributed Sales"
              value={formatStatMoney(stats?.revenue ?? 0, stats?.currency)}
              subtitle={stats?.orders
                ? `${stats.orders.toLocaleString()} ${stats.orders === 1 ? "order" : "orders"} your videos led to`
                : "What your videos sold for the brands in them"}
              icon={DollarSign}
              sparkline={stats?.revenueByDay}
              action={
                <>
                  <span className="block">No sales yet this month.</span>
                  <button type="button" className="stat-card__cta" onClick={() => navigate("/creator/my-videos")} data-testid="button-stat-tag-product">
                    Tag a brand's product in a video
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </>
              }
            />
            <StatCard
              title="Views"
              value={(stats?.views ?? 0).toLocaleString()}
              subtitle="Plays across every page your videos are embedded on"
              icon={Eye}
            />
            <StatCard
              title="Product clicks"
              value={(stats?.clicks ?? 0).toLocaleString()}
              subtitle="Taps through to a brand's store"
              icon={MousePointer}
            />
            <StatCard
              title="Click-through"
              value={`${(stats?.ctr ?? 0).toFixed(2)}%`}
              subtitle="Clicks per view"
              icon={MousePointer}
            />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-attributed-sales-note">
            <span className="font-medium text-foreground/80">Attributed Sales</span> is the value your
            videos generated for brands. Your commission is paid to you directly by the brand you work
            with, not through Materialized. Use it as your performance record when agreeing rates.
          </p>
        </section>
      )}

      {activeTab === "affiliate" && (
        <AffiliateCard
          trackingId={currentUser?.affiliateTrackingId || ""}
          referralCode={currentUser?.referralCode || ""}
          commissionRate={Number(currentUser?.commissionRate) || 0}
        />
      )}

      {/* Charity Support panel — HIDDEN, not deleted.
          The feature is scaffolding: users.charity_contribution has a column and a
          read path, but NOTHING in the codebase ever writes it (no endpoint, no
          form, no admin field) and there is no donation ledger, recipient or
          payout anywhere. It could only ever display $0.00, while telling the user
          "a portion of your earnings goes to charitable causes" — a claim about
          donating money that was never true. The "Manage Contributions" button also
          pointed at the subscription page, which has no charity controls.
          Restore this block, and the tab in components/DashboardTabs.tsx, once a
          real contribution rate + donation mechanism exists. */}
      {activeTab === "demo" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Video Demo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="aspect-video bg-muted rounded-xl flex items-center justify-center">
              <div className="text-center">
                <div className="h-16 w-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Play className="h-8 w-8 text-primary" />
                </div>
                <p className="text-muted-foreground">
                  Upload your first video to see the product detection and carousel in action
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "actions" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card className="hover-elevate cursor-pointer" onClick={() => setUploadModalOpen(true)}>
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 mx-auto rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold">Upload Video</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add a new video with product detection
              </p>
            </CardContent>
          </Card>
          <Card className="hover-elevate cursor-pointer" onClick={() => navigate("/creator/analytics")}>
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 mx-auto rounded-xl bg-chart-2/10 flex items-center justify-center mb-3">
                <Eye className="h-6 w-6 text-chart-2" />
              </div>
              <h3 className="font-semibold">View Analytics</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Check detailed performance metrics
              </p>
            </CardContent>
          </Card>
          <Card className="hover-elevate cursor-pointer" onClick={() => setActiveTab("performance")}>
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 mx-auto rounded-xl bg-chart-3/10 flex items-center justify-center mb-3">
                <TrendingUp className="h-6 w-6 text-chart-3" />
              </div>
              <h3 className="font-semibold">Optimize Performance</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Get AI-powered recommendations
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "performance" && (
        <AffiliateTable videos={videos} isLoading={videosLoading} />
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
