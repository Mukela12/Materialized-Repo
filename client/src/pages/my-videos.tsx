import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoCard } from "@/components/VideoCard";
import { VideoDetailSheet } from "@/components/VideoDetailSheet";
import { VideoUploadModal } from "@/components/VideoUploadModal";
import { EmbedCodeModal } from "@/components/EmbedCodeModal";
import { Upload, Search, Grid, List, Video } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Video as VideoType, Brand } from "@shared/schema";

const CATEGORY_FILTERS = [
  { value: "all",         label: "All" },
  { value: "fashion",     label: "Fashion" },
  { value: "travel",      label: "Travel" },
  { value: "skincare",    label: "Skincare" },
  { value: "cuisine_bev", label: "Cuisine & Bev" },
  { value: "health",      label: "Health" },
  { value: "eco",         label: "Eco" },
  { value: "interiors",   label: "Interiors" },
];

function parseCategories(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export default function MyVideos() {
  const [uploadModalOpen, setUploadModalOpen]     = useState(false);
  const [embedModalOpen, setEmbedModalOpen]       = useState(false);
  const [selectedVideo, setSelectedVideo]         = useState<VideoType | null>(null);
  const [detailSheetVideo, setDetailSheetVideo]   = useState<VideoType | null>(null);
  const [detailSheetOpen, setDetailSheetOpen]     = useState(false);
  const [searchQuery, setSearchQuery]             = useState("");
  const [viewMode, setViewMode]                   = useState<"grid" | "list">("grid");
  const [statusFilter, setStatusFilter]           = useState("all");
  const [categoryFilter, setCategoryFilter]       = useState("all");
  const [sortMode, setSortMode]                   = useState("newest");
  const { toast } = useToast();

  const { data: videos = [], isLoading } = useQuery<VideoType[]>({
    queryKey: ["/api/videos"],
  });

  const { data: brands = [] } = useQuery<Brand[]>({
    queryKey: ["/api/brands"],
  });

  // ── Filtering & Sorting ────────────────────────────────────────────────────
  const filteredVideos = videos
    .filter((video) => {
      const matchesSearch   = video.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus   = statusFilter === "all" || video.status === statusFilter;
      const matchesCategory = categoryFilter === "all" ||
        parseCategories(video.categories).includes(categoryFilter);
      return matchesSearch && matchesStatus && matchesCategory;
    })
    .sort((a, b) => {
      if (sortMode === "most_viewed")       return (b.totalViews ?? 0) - (a.totalViews ?? 0);
      if (sortMode === "highest_grossing")  return Number(b.totalRevenue ?? 0) - Number(a.totalRevenue ?? 0);
      // newest
      const da = new Date(a.createdAt ?? 0).getTime();
      const db = new Date(b.createdAt ?? 0).getTime();
      return db - da;
    });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const videoMutation = useMutation({
    mutationFn: async (data: {
      title: string; description?: string; videoUrl: string; brandIds: string[];
    }) => {
      const res = await apiRequest("POST", "/api/videos", data);
      return res.json();
    },
    onSuccess: (newVideo: VideoType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      toast({ title: "Video Uploaded!", description: "Your video is ready. Here's your embed code." });
      setSelectedVideo(newVideo);
      setEmbedModalOpen(true);
    },
    onError: () =>
      toast({ title: "Upload Failed", description: "There was an error uploading your video.", variant: "destructive" }),
  });

  const referralMutation = useMutation({
    mutationFn: async (data: {
      brandName: string; prContactName: string; prContactEmail: string;
      productCategory?: string; message?: string;
    }) => apiRequest("POST", "/api/referrals", data),
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals"] });
      toast({ title: "Referral Sent!", description: `We've sent an invitation to ${v.brandName}.` });
    },
    onError: () =>
      toast({ title: "Referral Failed", description: "There was an error sending the referral.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (videoId: string) => apiRequest("DELETE", `/api/videos/${videoId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      toast({ title: "Video Deleted", description: "The video has been removed." });
    },
    onError: () =>
      toast({ title: "Delete Failed", description: "There was an error deleting the video.", variant: "destructive" }),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleVideoUpload = async (data: {
    title: string; description?: string; videoUrl: string; selectedBrands: string[];
  }) => videoMutation.mutateAsync({ title: data.title, description: data.description, videoUrl: data.videoUrl, brandIds: data.selectedBrands });

  const handleReferBrand = async (data: {
    brandName: string; prContactName: string; prContactEmail: string;
    productCategory?: string; message?: string;
  }) => referralMutation.mutateAsync(data);

  const handleViewEmbed = (video: VideoType) => { setSelectedVideo(video); setEmbedModalOpen(true); };
  const handleDelete    = async (video: VideoType) => deleteMutation.mutateAsync(video.id);
  const handleOpenDetail = (video: VideoType) => { setDetailSheetVideo(video); setDetailSheetOpen(true); };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-24 md:pb-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">My Campaigns</h1>
          <p className="text-muted-foreground mt-1">Manage and track all your video campaigns</p>
        </div>
        <Button
          onClick={() => setUploadModalOpen(true)}
          className="rounded-full gap-2 w-full sm:w-auto"
          data-testid="button-upload-video-page"
        >
          <Upload className="h-4 w-4" />
          Upload Video
        </Button>
      </div>

      {/* Search + status tabs + sort + view toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search videos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-videos"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="published">Active</TabsTrigger>
                <TabsTrigger value="archived">Expired</TabsTrigger>
                <TabsTrigger value="draft">Drafts</TabsTrigger>
              </TabsList>
            </Tabs>

            <Select value={sortMode} onValueChange={setSortMode}>
              <SelectTrigger className="w-44 h-10 text-sm" data-testid="select-sort-mode">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="most_viewed">Most viewed</SelectItem>
                <SelectItem value="highest_grossing">Highest grossing</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex border rounded-lg overflow-hidden">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => setViewMode("grid")}
                className="rounded-none"
                data-testid="button-view-grid"
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => setViewMode("list")}
                className="rounded-none"
                data-testid="button-view-list"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Category pills */}
        <div className="flex flex-wrap gap-2" data-testid="category-filters">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat.value}
              data-testid={`filter-category-${cat.value}`}
              onClick={() => setCategoryFilter(cat.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                categoryFilter === cat.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-border hover:border-primary/50"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid / List */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-video w-full rounded-lg" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : filteredVideos.length === 0 ? (
        <div className="text-center py-16">
          <div className="h-20 w-20 mx-auto rounded-full bg-muted flex items-center justify-center mb-4">
            <Video className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">
            {statusFilter === "draft" ? "No drafts yet" :
             statusFilter === "archived" ? "No expired campaigns" :
             statusFilter === "published" ? "No active campaigns" :
             searchQuery || categoryFilter !== "all" ? "No campaigns found" : "No campaigns yet"}
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            {statusFilter === "draft" ? "Save a draft while uploading to see it here." :
             statusFilter === "archived" ? "Campaigns that have ended will appear here." :
             statusFilter === "published" ? "Published campaigns will appear here once your video is live." :
             searchQuery || categoryFilter !== "all"
              ? "Try adjusting your search or filters"
              : "Upload your first video to start generating revenue with product detection and affiliate tracking."}
          </p>
          {!searchQuery && statusFilter === "all" && categoryFilter === "all" && (
            <Button onClick={() => setUploadModalOpen(true)} className="rounded-full gap-2">
              <Upload className="h-4 w-4" />
              Upload Your First Campaign
            </Button>
          )}
        </div>
      ) : (
        <div className={
          viewMode === "grid"
            ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            : "space-y-4"
        }>
          {filteredVideos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onOpen={handleOpenDetail}
              onViewEmbed={handleViewEmbed}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <VideoUploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        brands={brands}
        onUpload={handleVideoUpload}
        onReferBrand={handleReferBrand}
      />

      <EmbedCodeModal
        open={embedModalOpen}
        onOpenChange={setEmbedModalOpen}
        video={selectedVideo}
      />

      <VideoDetailSheet
        video={detailSheetVideo}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
      />
    </div>
  );
}
