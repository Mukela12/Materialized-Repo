/**
 * Admin: the Most Engaged Video competition (client, 24 Oct 2026). Every
 * creator's videos with views and product clicks over a period, each with the
 * source its creator came from (Paris Creator Week, Partner A, Google Ads...),
 * so sources can be compared and a winner picked. Fed by engagementReport.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Trophy } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportToCsv } from "@/lib/exportCsv";

interface Row {
  id: string; title: string; status: string; creator_id: string; creator: string; email: string;
  source: string; views: number; clicks: number; ctr: number;
}

/** Click rate only means something once a video has been seen a few times. */
const MIN_VIEWS_FOR_RATE = 20;

export function EngagementBySource() {
  const [days, setDays] = useState("30");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState<"clicks" | "views" | "ctr">("clicks");
  const { data = [], isLoading } = useQuery<Row[]>({
    queryKey: ["/api/admin/activity/engagement", days],
    queryFn: async () => {
      const r = await fetch(`/api/admin/activity/engagement${days === "all" ? "" : `?days=${days}`}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
  });

  const sources = useMemo(() => Array.from(new Set(data.map((r) => r.source))).sort(), [data]);
  const bySource = useMemo(() => {
    const m = new Map<string, { videos: number; views: number; clicks: number }>();
    for (const r of data) {
      const s = m.get(r.source) ?? { videos: 0, views: 0, clicks: 0 };
      s.videos++; s.views += r.views; s.clicks += r.clicks;
      m.set(r.source, s);
    }
    return Array.from(m, ([name, s]) => ({ name, ...s, ctr: s.views ? Math.round((s.clicks / s.views) * 1000) / 10 : 0 }))
      .sort((a, b) => b.clicks - a.clicks || b.views - a.views);
  }, [data]);
  const ranked = useMemo(() => {
    const rows = data.filter((r) => source === "all" || r.source === source);
    const key = (r: Row) => sort === "ctr" ? (r.views >= MIN_VIEWS_FOR_RATE ? r.ctr : -1) : r[sort];
    return [...rows].sort((a, b) => key(b) - key(a) || b.views - a.views);
  }, [data, source, sort]);

  const exportRows = () => exportToCsv("most-engaged-videos", ranked, [
    { header: "Rank", value: (r) => String(ranked.indexOf(r) + 1) },
    { header: "Video", value: (r) => r.title },
    { header: "Creator", value: (r) => r.creator },
    { header: "Email", value: (r) => r.email },
    { header: "Source", value: (r) => r.source },
    { header: "Views", value: (r) => String(r.views) },
    { header: "Product clicks", value: (r) => String(r.clicks) },
    { header: "Click rate %", value: (r) => String(r.ctr) },
  ]);

  return (
    <Card data-testid="activity-engagement">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Trophy className="h-4 w-4" /> Most engaged videos</CardTitle>
        <CardDescription>
          For the Most Engaged Video competition: every creator's videos ranked by product clicks (or views, or click rate), with
          where each creator came from. Click rate counts once a video has {MIN_VIEWS_FOR_RATE}+ views.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-9 w-32" data-testid="engagement-period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-9 w-48" data-testid="engagement-source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger className="h-9 w-40" data-testid="engagement-sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="clicks">Most product clicks</SelectItem>
              <SelectItem value="views">Most views</SelectItem>
              <SelectItem value="ctr">Highest click rate</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={exportRows} disabled={ranked.length === 0}>Export CSV</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No videos yet.</p>
        ) : (
          <>
            <div data-testid="engagement-by-source">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">By source</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {bySource.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => setSource(source === s.name ? "all" : s.name)}
                    className={`text-left rounded-lg border p-2.5 transition-colors ${source === s.name ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                  >
                    <p className="text-xs font-medium truncate" title={s.name}>{s.name}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                      {s.videos} video{s.videos === 1 ? "" : "s"} · {s.views} views · {s.clicks} clicks{s.views ? ` · ${s.ctr}%` : ""}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <ol className="divide-y rounded-lg border" data-testid="engagement-ranking">
              {ranked.slice(0, 50).map((r, i) => (
                <li key={r.id} className="flex items-center gap-3 p-3">
                  <span className={`w-6 shrink-0 text-center text-sm font-semibold tabular-nums ${i < 3 ? "text-primary" : "text-muted-foreground"}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug line-clamp-2">{r.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{r.creator} · <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{r.source}</Badge></p>
                  </div>
                  <div className="grid grid-cols-3 gap-1 shrink-0 text-center w-[9.5rem] sm:w-48">
                    {[["Clicks", r.clicks], ["Views", r.views], ["Rate", r.views >= MIN_VIEWS_FOR_RATE ? `${r.ctr}%` : "–"]].map(([l, v]) => (
                      <div key={l as string} className={`rounded-md py-1 ${sort === (l === "Rate" ? "ctr" : String(l).toLowerCase()) ? "bg-primary/10" : "bg-muted/50"}`}>
                        <p className="text-xs font-semibold tabular-nums">{v}</p>
                        <p className="text-[9px] text-muted-foreground">{l}</p>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
              {ranked.length === 0 && <li className="p-3 text-sm text-muted-foreground">No videos from this source yet.</li>}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}
