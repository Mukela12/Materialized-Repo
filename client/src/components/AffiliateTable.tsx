import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, Search, Download, Eye, MousePointer, DollarSign } from "lucide-react";
import type { Video } from "@shared/schema";

interface AffiliateTableProps {
  videos: Video[];
  isLoading?: boolean;
  formatMoney?: (usd: number) => string;
}

export function AffiliateTable({ videos, isLoading, formatMoney }: AffiliateTableProps) {
  const fmtMoney = formatMoney || ((v: number) => `$${v.toFixed(2)}`);
  const calculateCTR = (clicks: number, views: number) => {
    if (views === 0) return "0.00";
    return ((clicks / views) * 100).toFixed(2);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-lg font-semibold">Performance Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <CardTitle className="text-lg font-semibold">Performance Data</CardTitle>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search videos..."
              className="pl-9"
              data-testid="input-search-performance"
            />
          </div>
          <Button variant="outline" size="icon" data-testid="button-export-data">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[300px]">
                <Button variant="ghost" size="sm" className="gap-1 -ml-3 font-semibold">
                  Video
                  <ArrowUpDown className="h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" className="gap-1 font-semibold">
                  <Eye className="h-3 w-3" />
                  Views
                  <ArrowUpDown className="h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" className="gap-1 font-semibold">
                  <MousePointer className="h-3 w-3" />
                  Clicks
                  <ArrowUpDown className="h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" className="gap-1 font-semibold">
                  CTR
                  <ArrowUpDown className="h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" className="gap-1 font-semibold">
                  <DollarSign className="h-3 w-3" />
                  Revenue
                  <ArrowUpDown className="h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {videos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Eye className="h-8 w-8 opacity-50" />
                    <p>No video data yet</p>
                    <p className="text-sm">Upload your first video to start tracking performance</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              videos.map((video) => (
                <TableRow key={video.id} data-testid={`row-video-${video.id}`}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <div className="w-16 h-9 rounded-md bg-muted flex-shrink-0 overflow-hidden">
                        {video.thumbnailUrl ? (
                          <img
                            src={video.thumbnailUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-chart-2/20" />
                        )}
                      </div>
                      <span className="truncate max-w-[180px]">{video.title}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{video.totalViews || 0}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{video.totalClicks || 0}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {calculateCTR(video.totalClicks || 0, video.totalViews || 0)}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold text-green-600">
                      {fmtMoney(Number(video.totalRevenue || 0))}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        video.status === "published"
                          ? "bg-green-500/20 text-green-600"
                          : video.status === "processing"
                          ? "bg-yellow-500/20 text-yellow-600"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {video.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
