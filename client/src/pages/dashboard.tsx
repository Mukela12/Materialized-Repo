import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/StatCard";
import { AffiliateCard } from "@/components/AffiliateCard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { AffiliateTable } from "@/components/AffiliateTable";
import { VideoUploadModal } from "@/components/VideoUploadModal";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { CreatorRewardNotification } from "@/components/EarningsNotification";
import { Eye, DollarSign, Heart, MousePointer, Upload, Play, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Video, Brand, User } from "@shared/schema";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("stats");
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

  const { data: stats } = useQuery<{
    totalViews: number;
    totalRevenue: number;
    charityContribution: number;
    averageCTR: number;
  }>({
    queryKey: ["/api/analytics/stats"],
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
      <div className="-mx-4 md:-mx-6 -mt-6 mb-4 overflow-hidden">
        <AnnouncementBanner />
      </div>

      <CreatorRewardNotification />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Manage your video commerce platform
          </p>
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">Stats This Month</CardTitle>
            <p className="text-sm text-muted-foreground">
              Your key performance metrics and analytics overview
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {stats ? (
                <>
                  <StatCard
                    title="Total Views"
                    value={stats.totalViews}
                    subtitle="Video engagement"
                    icon={Eye}
                  />
                  <StatCard
                    title="Total Revenue"
                    value={`$${stats.totalRevenue.toFixed(0)}`}
                    subtitle="Sales generated"
                    icon={DollarSign}
                  />
                  <StatCard
                    title="Charity Contributions"
                    value={`$${stats.charityContribution.toFixed(2)}`}
                    subtitle="Total donated"
                    icon={Heart}
                  />
                  <StatCard
                    title="Average CTR"
                    value={`${stats.averageCTR.toFixed(2)}%`}
                    subtitle="Click-through rate"
                    icon={MousePointer}
                  />
                </>
              ) : (
                <>
                  <StatCard title="Total Views" value={0} subtitle="Video engagement" icon={Eye} />
                  <StatCard title="Total Revenue" value="$0" subtitle="Sales generated" icon={DollarSign} />
                  <StatCard title="Charity Contributions" value="$0.00" subtitle="Total donated" icon={Heart} />
                  <StatCard title="Average CTR" value="0.00%" subtitle="Click-through rate" icon={MousePointer} />
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "affiliate" && (
        <AffiliateCard
          trackingId={currentUser?.affiliateTrackingId || "f917b3b7-xxxx-xxxx"}
          referralCode={currentUser?.referralCode || "REF_E6601237"}
          commissionRate={Number(currentUser?.commissionRate) || 15}
        />
      )}

      {activeTab === "charity" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5 text-red-500" />
              Charity Support
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <div className="h-20 w-20 mx-auto rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                <Heart className="h-10 w-10 text-red-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">
                ${Number(currentUser?.charityContribution || 0).toFixed(2)} Contributed
              </h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                A portion of your earnings goes to charitable causes. Adjust your contribution rate in settings.
              </p>
              <Button variant="outline" className="mt-4 rounded-full">
                Manage Contributions
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
          <Card className="hover-elevate cursor-pointer">
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
          <Card className="hover-elevate cursor-pointer">
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
