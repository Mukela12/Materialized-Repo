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
import { Eye, MousePointer, DollarSign } from "lucide-react";
import type { Video } from "@shared/schema";
import { useTableControls } from "@/hooks/useTableControls";
import { exportToCsv } from "@/lib/exportCsv";
import { TableToolbar, SortableHeader } from "@/components/TableToolbar";

interface AffiliateTableProps {
  videos: Video[];
  isLoading?: boolean;
  formatMoney?: (usd: number) => string;
}

const calculateCTR = (clicks: number, views: number) => {
  if (views === 0) return "0.00";
  return ((clicks / views) * 100).toFixed(2);
};

export function AffiliateTable({ videos, isLoading, formatMoney }: AffiliateTableProps) {
  const fmtMoney = formatMoney || ((v: number) => `$${v.toFixed(2)}`);

  const { query, setQuery, sortKey, sortDir, toggleSort, rows } = useTableControls(videos, {
    searchFields: (v) => [v.title, v.status],
    sortAccessors: {
      title: (v) => v.title,
      views: (v) => v.totalViews ?? 0,
      clicks: (v) => v.totalClicks ?? 0,
      ctr: (v) => Number(calculateCTR(v.totalClicks ?? 0, v.totalViews ?? 0)),
      revenue: (v) => Number(v.totalRevenue ?? 0),
    },
  });

  const handleExport = () =>
    exportToCsv("performance-data", rows, [
      { header: "Video", value: (v) => v.title },
      { header: "Views", value: (v) => v.totalViews ?? 0 },
      { header: "Clicks", value: (v) => v.totalClicks ?? 0 },
      { header: "CTR (%)", value: (v) => calculateCTR(v.totalClicks ?? 0, v.totalViews ?? 0) },
      { header: "Revenue", value: (v) => v.totalRevenue ?? 0 },
      { header: "Status", value: (v) => v.status },
    ]);

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
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          onExport={handleExport}
          exportDisabled={rows.length === 0}
          searchPlaceholder="Search videos…"
          data-testid="performance-toolbar"
        />
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHeader label="Video" sortKey="title" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-[300px]" />
              <SortableHeader label="Views" sortKey="views" activeKey={sortKey} dir={sortDir} onSort={toggleSort} icon={<Eye className="h-3 w-3" />} />
              <SortableHeader label="Clicks" sortKey="clicks" activeKey={sortKey} dir={sortDir} onSort={toggleSort} icon={<MousePointer className="h-3 w-3" />} />
              <SortableHeader label="CTR" sortKey="ctr" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableHeader label="Revenue" sortKey="revenue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} icon={<DollarSign className="h-3 w-3" />} />
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Eye className="h-8 w-8 opacity-50" />
                    <p>{videos.length === 0 ? "No video data yet" : "No videos match your search"}</p>
                    <p className="text-sm">Upload your first video to start tracking performance</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((video) => (
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
