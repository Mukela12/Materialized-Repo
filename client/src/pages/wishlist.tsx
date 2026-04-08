import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Play, Search } from "lucide-react";
import { WishlistHeart } from "@/components/WishlistHeart";
import heartIcon from "@assets/WISHLIST_ICON_materialized_saas_1773416652092.png";

const CATEGORIES = [
  { value: "all",         label: "All" },
  { value: "fashion",     label: "Fashion" },
  { value: "travel",      label: "Travel" },
  { value: "skincare",    label: "Skincare" },
  { value: "cuisine_bev", label: "Cuisine & Bev" },
  { value: "health",      label: "Health" },
  { value: "eco",         label: "Eco" },
  { value: "interiors",   label: "Interiors" },
];

const CATEGORY_COLORS: Record<string, string> = {
  fashion:     "bg-pink-500/15 text-pink-600",
  travel:      "bg-blue-500/15 text-blue-600",
  skincare:    "bg-violet-500/15 text-violet-600",
  cuisine_bev: "bg-orange-500/15 text-orange-600",
  health:      "bg-green-500/15 text-green-600",
  eco:         "bg-emerald-500/15 text-emerald-600",
  interiors:   "bg-stone-500/15 text-stone-600",
};

type WishlistEntry = {
  wishlistId: string;
  globalListingId: string;
  addedAt: string;
  listing: {
    id: string;
    licenseFee: string;
    listingTitle: string | null;
    listingDescription: string | null;
    category: string | null;
    totalLicenses: number;
    video: { id: string; title: string; thumbnailUrl: string | null } | null;
    creator: { displayName: string; avatarUrl: string | null } | null;
  };
};

export default function WishlistPage() {
  const [searchQuery, setSearchQuery]   = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const { data: wishlistItems = [], isLoading } = useQuery<WishlistEntry[]>({
    queryKey: ["/api/wishlist"],
  });

  const filtered = wishlistItems.filter((item) => {
    const title = (item.listing.listingTitle || item.listing.video?.title || "").toLowerCase();
    const matchSearch = !searchQuery || title.includes(searchQuery.toLowerCase());
    const matchCat =
      categoryFilter === "all" ||
      (item.listing.category ?? "").toLowerCase() === categoryFilter;
    return matchSearch && matchCat;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-28 md:pb-8">
      <div className="flex items-center gap-3">
        <img
          src={heartIcon}
          alt="wishlist"
          className="w-10 h-10 object-contain"
          style={{ filter: "drop-shadow(0 0 8px rgba(200,200,200,0.6))" }}
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            My Wishlist
          </h1>
          <p className="text-muted-foreground text-sm">
            Videos you've saved from the Global Library
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search saved videos..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-search-wishlist"
        />
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2" data-testid="wishlist-category-filters">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            data-testid={`wishlist-filter-${cat.value}`}
            onClick={() => setCategoryFilter(cat.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              categoryFilter === cat.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/50 text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pt-8">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <Skeleton className="h-40 w-full rounded-t-lg" />
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 space-y-4">
          <img
            src={heartIcon}
            alt="empty wishlist"
            className="w-20 h-20 object-contain mx-auto opacity-20"
          />
          <div>
            <p className="text-lg font-medium text-muted-foreground">
              {searchQuery || categoryFilter !== "all"
                ? "No saved videos match your filters"
                : "Your wishlist is empty"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {searchQuery || categoryFilter !== "all"
                ? "Try adjusting your search or category filter."
                : "Browse the Global Video Library and tap the heart icon to save videos here."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pt-8">
          {filtered.map((item) => {
            const cat = (item.listing.category ?? "").toLowerCase();
            const badgeClass = CATEGORY_COLORS[cat] ?? "bg-muted/50 text-muted-foreground";
            const title = item.listing.listingTitle || item.listing.video?.title || "Untitled Video";
            return (
              <div key={item.wishlistId} className="relative">
                <Card
                  data-testid={`wishlist-card-${item.globalListingId}`}
                  className="overflow-hidden transition-all hover:shadow-md"
                >
                  <div className="relative aspect-video bg-muted">
                    {item.listing.video?.thumbnailUrl ? (
                      <img
                        src={item.listing.video.thumbnailUrl}
                        alt={title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Play className="w-10 h-10 text-muted-foreground" />
                      </div>
                    )}
                    {item.listing.category && (
                      <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${badgeClass}`}>
                        {CATEGORIES.find((c) => c.value === cat)?.label ?? item.listing.category}
                      </span>
                    )}
                  </div>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm line-clamp-1">{title}</CardTitle>
                    <CardDescription>by {item.listing.creator?.displayName ?? "Unknown Creator"}</CardDescription>
                  </CardHeader>
                  <CardFooter className="pt-0 text-xs text-muted-foreground">
                    {item.listing.totalLicenses} licenses · €{item.listing.licenseFee}
                  </CardFooter>
                </Card>
                <WishlistHeart listingId={item.globalListingId} wishlisted={true} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
