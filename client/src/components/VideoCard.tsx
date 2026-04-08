import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Eye, MousePointer, DollarSign, MoreVertical, Code } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Video } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  draft:      "bg-muted text-muted-foreground border-border",
  processing: "bg-yellow-500/15 text-yellow-600 border-yellow-500/20",
  published:  "bg-green-500/15 text-green-600 border-green-500/20",
  archived:   "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

const CATEGORY_COLORS: Record<string, string> = {
  fashion:     "bg-pink-500/15 text-pink-600",
  travel:      "bg-blue-500/15 text-blue-600",
  skincare:    "bg-violet-500/15 text-violet-600",
  cuisine_bev: "bg-orange-500/15 text-orange-600",
  health:      "bg-green-500/15 text-green-600",
  eco:         "bg-emerald-500/15 text-emerald-600",
  interiors:   "bg-stone-500/15 text-stone-600",
};

const CATEGORY_LABELS: Record<string, string> = {
  fashion:     "Fashion",
  travel:      "Travel",
  skincare:    "Skincare",
  cuisine_bev: "Cuisine & Bev",
  health:      "Health",
  eco:         "Eco",
  interiors:   "Interiors",
};

function parseCategories(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

interface VideoCardProps {
  video: Video;
  onOpen?: (video: Video) => void;
  onEdit?: (video: Video) => void;
  onViewEmbed?: (video: Video) => void;
  onDelete?: (video: Video) => void;
}

export function VideoCard({ video, onOpen, onEdit, onViewEmbed, onDelete }: VideoCardProps) {
  const categories = parseCategories(video.categories);

  return (
    <Card
      className="overflow-hidden group cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
      onClick={() => onOpen?.(video)}
      data-testid={`card-video-${video.id}`}
    >
      {/* ── Thumbnail ─────────────────────────────────────────── */}
      <div className="relative aspect-video bg-muted">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-chart-2/20">
            <Play className="h-12 w-12 text-primary/50" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="h-12 w-12 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="h-5 w-5 text-black fill-black ml-0.5" />
          </div>
        </div>

        {/* ⋮ menu — stopPropagation so it doesn't open the detail sheet */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              data-testid={`button-video-menu-${video.id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onEdit?.(video)}>
              Edit Video
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onViewEmbed?.(video)}>
              <Code className="h-4 w-4 mr-2" />
              Get Embed Code
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete?.(video)}
              className="text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Card body ─────────────────────────────────────────── */}
      <CardContent className="p-4 space-y-2.5">

        {/* Status badge + categories on the same row */}
        <div className="flex items-center flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize ${STATUS_COLORS[video.status ?? "draft"]}`}
            data-testid={`badge-status-${video.id}`}
          >
            {video.status ?? "draft"}
          </Badge>

          {categories.slice(0, 2).map((cat) => (
            <Badge
              key={cat}
              variant="secondary"
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[cat] ?? "bg-muted text-muted-foreground"}`}
              data-testid={`badge-category-${video.id}-${cat}`}
            >
              {CATEGORY_LABELS[cat] ?? cat}
            </Badge>
          ))}

          {categories.length > 2 && (
            <Badge
              variant="secondary"
              className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              +{categories.length - 2}
            </Badge>
          )}
        </div>

        {/* Title */}
        <h3
          className="font-semibold leading-snug truncate text-sm"
          data-testid={`text-video-title-${video.id}`}
        >
          {video.title}
        </h3>

        {/* Description */}
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {video.description || "No description"}
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-1.5 text-center pt-0.5">
          <div className="p-1.5 rounded-lg bg-muted/50">
            <Eye className="h-3 w-3 mx-auto text-muted-foreground mb-0.5" />
            <p className="text-xs font-semibold leading-none">{(video.totalViews ?? 0).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Views</p>
          </div>
          <div className="p-1.5 rounded-lg bg-muted/50">
            <MousePointer className="h-3 w-3 mx-auto text-muted-foreground mb-0.5" />
            <p className="text-xs font-semibold leading-none">{(video.totalClicks ?? 0).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Clicks</p>
          </div>
          <div className="p-1.5 rounded-lg bg-muted/50">
            <DollarSign className="h-3 w-3 mx-auto text-muted-foreground mb-0.5" />
            <p className="text-xs font-semibold leading-none">${Number(video.totalRevenue ?? 0).toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Revenue</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
