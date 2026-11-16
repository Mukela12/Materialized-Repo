/**
 * The creator dashboard (client, 16 Nov 2026): averages for a period against
 * the period before, sales by where they came from, a chart, Paid vs Upcoming
 * earnings (after Airbnb's host Earnings screen) and a row per video.
 * Numbers come from GET /api/creator/dashboard (server/creatorDashboard.ts).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDownRight, ArrowUpRight, CalendarDays, Clock, DollarSign, Eye, Gauge, Globe, MousePointerClick, Package, Percent, Repeat2,
  ShoppingBag, Store, Target, Users, Wallet,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { VIDEO_CATEGORY_OPTIONS } from "@shared/schema";
import {
  DASHBOARD_CURRENCIES, formatWatchDuration, pctChange,
  type CreatorDashboard as Dashboard, type DashboardCurrency, type DashboardProduct, type DashboardSeriesPoint, type DashboardViewSource,
} from "@shared/creatorDashboard";

const DAY = 86_400_000;
type Preset = "1d" | "7d" | "30d" | "custom";
const PRESETS: { id: Exclude<Preset, "custom">; label: string; days: number }[] = [
  { id: "1d", label: "1D", days: 1 },
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
];

/**
 * Sales sources. Categorical slots 1 to 3 of the reference palette, checked
 * with the palette validator in both themes; each is always shown with its
 * name and count beside it, never by colour alone.
 */
const SOURCES = [
  { key: "own", label: "Your audience", light: "#2a78d6", dark: "#3987e5" },
  { key: "publisher", label: "Publishers", light: "#eb6834", dark: "#d95926" },
  { key: "brand", label: "Brand reposts", light: "#1baf7a", dark: "#199e70" },
] as const;

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(VIDEO_CATEGORY_OPTIONS.map((o) => [o.value, o.label]));

/** Money in the dashboard's currency: exact for figures, whole units for chart axes. */
function moneyFormat(currency: string) {
  const whole = new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 });
  const exact = new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() });
  return {
    exact: (cents: number) => exact.format((cents || 0) / 100),
    whole: (cents: number) => whole.format((cents || 0) / 100),
  };
}

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));

/** "vs previous 7 days", with the change in colour and an arrow, or nothing to compare. */
function Delta({ current, previous, label }: { current: number; previous: number; label: string }) {
  const change = pctChange(current, previous);
  if (change == null) {
    return <p className="mt-2 text-[11px] text-muted-foreground">{current > 0 ? `New vs ${label}` : `Nothing in ${label}`}</p>;
  }
  if (change === 0) return <p className="mt-2 truncate text-[11px] text-muted-foreground">Same as {label}</p>;
  const up = change > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className={cn("inline-flex items-center font-medium tabular-nums", up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
        <Icon className="h-3 w-3" aria-hidden="true" />
        {Math.abs(change)}%
      </span>
      <span className="truncate">vs {label}</span>
    </p>
  );
}

function Metric({
  icon: Icon, label, value, hint, current, previous, compare, testId,
}: {
  icon: LucideIcon; label: string; value: string; hint?: string; current: number; previous: number; compare: string; testId: string;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-3.5 md:p-5">
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
          <p className="truncate text-[12px] font-medium">{label}</p>
        </div>
        <p
          className={cn("mt-2 text-[clamp(1.25rem,4.5vw,1.75rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums", current === 0 && "text-foreground/40")}
          data-testid={testId}
        >
          {value}
        </p>
        {hint && <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
        <Delta current={current} previous={previous} label={compare} />
      </CardContent>
    </Card>
  );
}

function periodLabel(preset: Preset, range: { from: Date; to: Date }): string {
  if (preset === "1d") return "prior 24 hours";
  if (preset === "7d") return "prior 7 days";
  if (preset === "30d") return "prior 30 days";
  const days = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / DAY));
  return `prior ${days} ${days === 1 ? "day" : "days"}`;
}

/** A bucket key ("YYYY-MM-DD" or "YYYY-MM-DDTHH", UTC) as a date, or null. */
function bucketDate(t: unknown, bucket: "hour" | "day"): Date | null {
  if (typeof t !== "string") return null;
  const d = new Date(bucket === "hour" ? `${t}:00:00Z` : `${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function tickLabel(t: unknown, bucket: "hour" | "day") {
  const d = bucketDate(t, bucket);
  return d ? format(d, bucket === "hour" ? "HH:mm" : "d MMM") : "";
}

function tooltipLabel(t: unknown, bucket: "hour" | "day") {
  const d = bucketDate(t, bucket);
  return d ? format(d, bucket === "hour" ? "d MMM, HH:mm" : "EEE d MMM") : "";
}

const SERIES_METRICS = [
  { key: "views", label: "Views" },
  { key: "clicks", label: "Clicks" },
  { key: "grossCents", label: "Sales value" },
] as const;
type SeriesMetric = (typeof SERIES_METRICS)[number]["key"];

function TrendChart({ series, bucket, money }: { series: DashboardSeriesPoint[]; bucket: "hour" | "day"; money: (c: number) => string }) {
  const [metric, setMetric] = useState<SeriesMetric>("views");
  const total = series.reduce((n, p) => n + (p[metric] || 0), 0);
  const fmt = (v: number) => (metric === "grossCents" ? money(v) : num(v));
  const current = SERIES_METRICS.find((m) => m.key === metric)!;
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium text-muted-foreground">{current.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] tabular-nums" data-testid="text-trend-total">{fmt(total)}</p>
          </div>
          <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Chart metric">
            {SERIES_METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={metric === m.key}
                onClick={() => setMetric(m.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  metric === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`button-trend-${m.key}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 h-56" data-testid="chart-dashboard-trend">
          {total === 0 ? (
            <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 px-6 text-center text-sm text-muted-foreground">
              {metric === "grossCents" ? "No sales yet in this period." : metric === "clicks" ? "No product clicks yet in this period." : "No views yet in this period."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="t"
                  tickFormatter={(t: unknown) => tickLabel(t, bucket)}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  minTickGap={24}
                  className="fill-muted-foreground"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={metric === "grossCents" ? 56 : 32}
                  allowDecimals={false}
                  tickFormatter={(v: number) => fmt(v)}
                  className="fill-muted-foreground"
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
                  contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--card))", fontSize: 12 }}
                  labelFormatter={(t: unknown) => tooltipLabel(t, bucket)}
                  formatter={(v: number) => [fmt(v), current.label]}
                />
                <Area
                  type="monotone"
                  dataKey={metric}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="hsl(var(--primary))"
                  fillOpacity={0.1}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SourcesDonut({ sales, prevTotal, compare }: { sales: Dashboard["current"]["sales"]; prevTotal: number; compare: string }) {
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const data = SOURCES.map((s) => ({ ...s, value: sales[s.key], color: dark ? s.dark : s.light }));
  return (
    <Card className="min-w-0">
      <CardContent className="p-4 md:p-5">
        <p className="text-[12px] font-medium text-muted-foreground">Sales by source</p>
        <div className="mt-3 flex items-center gap-4">
          <div className="relative h-32 w-32 shrink-0" data-testid="chart-sales-sources">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={sales.total > 0 ? data : [{ key: "none", value: 1, color: "hsl(var(--muted))" }]}
                  dataKey="value"
                  innerRadius="72%"
                  outerRadius="100%"
                  paddingAngle={sales.total > 0 && data.filter((d) => d.value > 0).length > 1 ? 3 : 0}
                  cornerRadius={4}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {(sales.total > 0 ? data : [{ key: "none", color: "hsl(var(--muted))" }]).map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Pie>
                {sales.total > 0 && (
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--card))", fontSize: 12 }}
                    formatter={(v: number, _n: string, p: any) => [`${v} ${v === 1 ? "sale" : "sales"}`, p?.payload?.label]}
                  />
                )}
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tabular-nums leading-none" data-testid="text-sales-total">{sales.total}</span>
              <span className="mt-1 text-[11px] text-muted-foreground">{sales.total === 1 ? "sale" : "sales"}</span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-2.5">
            {data.map((d) => (
              <li key={d.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden="true" />
                  <span className="truncate text-muted-foreground">{d.label}</span>
                </span>
                <span className="font-medium tabular-nums">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
        {sales.total === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">No sales yet in this period. They show here split by who brought the buyer.</p>
        ) : (
          <Delta current={sales.total} previous={prevTotal} label={compare} />
        )}
      </CardContent>
    </Card>
  );
}

function EarningsCard({ d, money }: { d: Dashboard; money: { exact: (c: number) => string } }) {
  const p = d.payouts;
  const paidShare = p.totalCents > 0 ? (p.paidCents / p.totalCents) * 100 : 0;
  return (
    <Card className="min-w-0">
      <CardContent className="grid gap-6 p-4 md:grid-cols-2 md:gap-10 md:p-5">
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Wallet className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
            <p className="text-[12px] font-medium">Earnings this period</p>
          </div>
          {d.category && <p className="mt-1 text-[11px] text-muted-foreground">All categories: payouts are for your whole account.</p>}
          <p className={cn("mt-2 text-3xl font-semibold tracking-[-0.03em] tabular-nums", p.totalCents === 0 && "text-foreground/40")} data-testid="text-earnings-total">
            {money.exact(p.totalCents)}
          </p>
          <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {p.paidCents > 0 && <div className="h-full rounded-full bg-foreground" style={{ width: `${paidShare}%` }} />}
            {p.upcomingCents > 0 && <div className="h-full rounded-full bg-primary" style={{ width: `${100 - paidShare}%` }} />}
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-2 text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full bg-foreground" aria-hidden="true" />Paid</dt>
              <dd className="font-medium tabular-nums" data-testid="text-earnings-paid">{money.exact(p.paidCents)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-2 text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />Upcoming</dt>
              <dd className="font-medium tabular-nums" data-testid="text-earnings-upcoming">{money.exact(p.upcomingCents)}</dd>
            </div>
          </dl>
          {p.totalCents === 0 && <p className="mt-3 text-xs text-muted-foreground">No earnings in this period yet. Commission from your sales shows here.</p>}
          {p.bonusCents > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">Includes {money.exact(p.bonusCents)} from brand subscription bonuses.</p>
          )}
        </div>

        <div className="border-t pt-4 md:border-l md:border-t-0 md:pl-10 md:pt-0">
          <div className="flex items-baseline justify-between">
            <p className="text-[12px] font-medium text-muted-foreground">Upcoming payouts</p>
            {p.allUpcomingCents > 0 && <p className="text-[12px] font-medium tabular-nums">{money.exact(p.allUpcomingCents)}</p>}
          </div>
          {p.upcomingList.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing waiting to be paid.</p>
          ) : (
            <ul className="mt-1 divide-y" data-testid="list-upcoming-payouts">
              {p.upcomingList.slice(0, 6).map((u) => (
                <li key={u.date} className="flex items-center justify-between py-2 text-sm">
                  <span>{format(new Date(`${u.date}T12:00:00Z`), "EEE d MMM yyyy")}</span>
                  <span className="font-medium tabular-nums">{money.exact(u.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Commission is paid {p.holdDays} days after the sale, on the Monday payout run, so a refund in that time never reaches you.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TopProductsCard({ products, money }: { products: DashboardProduct[]; money: { exact: (c: number) => string } }) {
  const bySales = products.some((p) => p.sales > 0);
  return (
    <Card className="min-w-0">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Package className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          <p className="text-[12px] font-medium">{bySales || products.length === 0 ? "Top products by sales" : "Top products by clicks"}</p>
        </div>
        {products.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No product sales or clicks yet in this period.</p>
        ) : (
          <ol className="mt-2 divide-y" data-testid="list-top-products">
            {products.map((p, i) => (
              <li key={p.key} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-right tabular-nums">
                  {bySales ? (
                    <>
                      <span className="font-medium">{p.sales} {p.sales === 1 ? "sale" : "sales"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{money.exact(p.grossCents)}</span>
                    </>
                  ) : (
                    <span className="font-medium">{p.clicks} {p.clicks === 1 ? "click" : "clicks"}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

const regionNames = (() => {
  try { return new Intl.DisplayNames(undefined, { type: "region" }); } catch { return null; }
})();
const countryName = (code: string) => {
  try { return regionNames?.of(code.toUpperCase()) ?? code; } catch { return code; }
};

function SourceList({ rows, unknown, name, testId }: { rows: DashboardViewSource[]; unknown: string; name: (l: string) => string; testId: string }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-muted-foreground">No views yet in this period.</p>;
  return (
    <ol className="mt-2 space-y-2.5" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.label ?? "unknown"} className="text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("min-w-0 truncate", r.label == null && "text-muted-foreground")}>{r.label == null ? unknown : name(r.label)}</span>
            <span className="shrink-0 tabular-nums">
              {r.views.toLocaleString()}
              <span className="ml-1.5 text-xs text-muted-foreground">{r.sharePct}%</span>
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, r.sharePct)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function ViewSourcesCard({ sources }: { sources: Dashboard["viewSources"] }) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Globe className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          <p className="text-[12px] font-medium">Where views come from</p>
        </div>
        <div className="mt-2 grid gap-5 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sites</p>
            <SourceList rows={sources.referrers} unknown="Direct or unknown" name={(l) => l} testId="list-view-referrers" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Countries</p>
            <SourceList rows={sources.countries} unknown="Unknown" name={countryName} testId="list-view-countries" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VideoTable({ d, money }: { d: Dashboard; money: { exact: (c: number) => string } }) {
  if (d.videos.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          {d.category ? `No ${CATEGORY_LABEL[d.category] ?? d.category} videos in this period.` : "No videos in this period yet. Publish a video to see its numbers here."}
        </CardContent>
      </Card>
    );
  }
  const salesCell = (s: Dashboard["videos"][number]["sales"]) =>
    s.total === 0 ? <span className="text-muted-foreground">0</span> : (
      <span title={`Your audience ${s.own}, Publishers ${s.publisher}, brand reposts ${s.brand}`}>
        {s.total}
        <span className="ml-1 text-[11px] text-muted-foreground">({s.own}/{s.publisher}/{s.brand})</span>
      </span>
    );
  return (
    <Card className="min-w-0">
      <CardContent className="p-0">
        <div className="flex items-baseline justify-between px-4 pt-4 md:px-5">
          <p className="text-[12px] font-medium text-muted-foreground">By video</p>
          <p className="text-[11px] text-muted-foreground">Sales: your audience / Publishers / brand reposts</p>
        </div>
        {/* Phones: one card per video, stats two by two. */}
        <ul className="mt-3 divide-y md:hidden" data-testid="list-dashboard-videos">
          {d.videos.map((v) => (
            <li key={v.videoId} className="px-4 py-3">
              <div className="flex items-center gap-3">
                {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" loading="lazy" /> : <div className="h-10 w-10 shrink-0 rounded-md bg-muted" />}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{v.title}</p>
                  <p className="text-[11px] text-muted-foreground">{v.category ? CATEGORY_LABEL[v.category] ?? v.category : "No category"}</p>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between"><dt className="text-muted-foreground">Views</dt><dd className="tabular-nums">{num(v.views)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Clicks</dt><dd className="tabular-nums">{num(v.clicks)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Avg. view</dt><dd className="tabular-nums">{formatWatchDuration(v.avgViewSeconds)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Reposts</dt><dd className="tabular-nums">{v.reposts}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Sales</dt><dd className="tabular-nums">{salesCell(v.sales)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Sales value</dt><dd className="tabular-nums">{money.exact(v.grossCents)}</dd></div>
                <div className="col-span-2 flex justify-between"><dt className="text-muted-foreground">Your commission</dt><dd className="tabular-nums">{money.exact(v.commissionCents)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full text-sm" data-testid="table-dashboard-videos">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2 font-medium">Video</th>
                <th className="px-3 py-2 text-right font-medium">Views</th>
                <th className="px-3 py-2 text-right font-medium">Clicks</th>
                <th className="px-3 py-2 text-right font-medium">Avg. view</th>
                <th className="px-3 py-2 text-right font-medium">Reposts</th>
                <th className="px-3 py-2 text-right font-medium">Sales</th>
                <th className="px-3 py-2 text-right font-medium">Sales value</th>
                <th className="px-5 py-2 text-right font-medium">Commission</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.videos.map((v) => (
                <tr key={v.videoId} className="hover:bg-muted/40">
                  <td className="max-w-[280px] px-5 py-2.5">
                    <div className="flex items-center gap-3">
                      {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" loading="lazy" /> : <div className="h-9 w-9 shrink-0 rounded-md bg-muted" />}
                      <div className="min-w-0">
                        <p className="truncate font-medium">{v.title}</p>
                        <p className="text-[11px] text-muted-foreground">{v.category ? CATEGORY_LABEL[v.category] ?? v.category : "No category"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(v.views)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(v.clicks)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatWatchDuration(v.avgViewSeconds)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{v.reposts}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{salesCell(v.sales)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money.exact(v.grossCents)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{money.exact(v.commissionCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function presetRange(days: number): { from: Date; to: Date } {
  const to = new Date();
  return { from: new Date(to.getTime() - days * DAY), to };
}

export function CreatorDashboard() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [range, setRange] = useState(() => presetRange(30));
  const [picked, setPicked] = useState<DateRange | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [category, setCategory] = useState("all");
  const [currency, setCurrency] = useState<DashboardCurrency>("usd");

  const url = `/api/creator/dashboard?${new URLSearchParams({
    from: range.from.toISOString(), to: range.to.toISOString(), category, currency,
  }).toString()}`;
  const { data, isLoading, isError } = useQuery<Dashboard>({ queryKey: [url], placeholderData: (prev) => prev });
  // The server says which currency it used (US dollars if a rate was missing).
  const shownCurrency = data?.currency ?? currency;
  const fmt = useMemo(() => moneyFormat(shownCurrency), [shownCurrency]);
  const compare = periodLabel(preset, range);

  const choosePreset = (p: (typeof PRESETS)[number]) => {
    setPreset(p.id);
    setPicked(undefined);
    setRange(presetRange(p.days));
  };
  const applyCustom = (r: DateRange | undefined) => {
    setPicked(r);
    if (r?.from && r?.to) {
      const from = new Date(r.from.getFullYear(), r.from.getMonth(), r.from.getDate());
      const to = new Date(r.to.getFullYear(), r.to.getMonth(), r.to.getDate() + 1);
      setPreset("custom");
      setRange({ from, to });
      setCalendarOpen(false);
    }
  };

  const c = data?.current;
  const p = data?.previous;

  return (
    <section className="space-y-4" aria-labelledby="creator-dashboard-title" data-testid="section-creator-dashboard">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="creator-dashboard-title" className="text-lg font-semibold tracking-tight">Performance</h2>
          <p className="text-sm text-muted-foreground">
            {data ? `${format(new Date(data.period.from), "d MMM")} to ${format(new Date(new Date(data.period.to).getTime() - 1), "d MMM yyyy")}, averages per video across ${data.videoCount} ${data.videoCount === 1 ? "video" : "videos"}` : "Averages per video for the period you pick"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Period">
            {PRESETS.map((pr) => (
              <button
                key={pr.id}
                type="button"
                onClick={() => choosePreset(pr)}
                aria-pressed={preset === pr.id}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  preset === pr.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`button-period-${pr.id}`}
              >
                {pr.label}
              </button>
            ))}
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-pressed={preset === "custom"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    preset === "custom" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid="button-period-custom"
                >
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  {preset === "custom" ? `${format(range.from, "d MMM")} to ${format(new Date(range.to.getTime() - 1), "d MMM")}` : "Custom"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={picked}
                  onSelect={applyCustom}
                  numberOfMonths={typeof window !== "undefined" && window.innerWidth >= 768 ? 2 : 1}
                  defaultMonth={new Date(Date.now() - 30 * DAY)}
                  disabled={{ after: new Date() }}
                />
                <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Pick a first and a last day.</p>
              </PopoverContent>
            </Popover>
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-8 w-[150px] text-xs" data-testid="select-dashboard-category" aria-label="Category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {VIDEO_CATEGORY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Currency">
            {DASHBOARD_CURRENCIES.map((cur) => (
              <button
                key={cur}
                type="button"
                onClick={() => setCurrency(cur)}
                aria-pressed={currency === cur}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  currency === cur ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`button-currency-${cur}`}
              >
                {cur.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isError && !data ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">The dashboard could not load. Try again in a moment.</CardContent></Card>
      ) : isLoading || !data || !c || !p ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[112px] rounded-xl" />)}
        </div>
      ) : (
        <>
          {data.fx.approximate && (
            <p className="text-[11px] text-muted-foreground">Some amounts could not be converted today, so they are shown as recorded.</p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric icon={Eye} label="Views" value={num(c.views)}
              hint={`${c.watchSessions} timed viewings`}
              current={c.views} previous={p.views} compare={compare} testId="stat-views" />
            <Metric icon={Clock} label="Avg. view time" value={formatWatchDuration(c.avgViewSeconds)}
              hint={c.watchSessions > 0 ? `${c.avgCompletionPct}% of each video` : "No watch time yet"}
              current={c.avgViewSeconds} previous={p.avgViewSeconds} compare={compare} testId="stat-avg-view-duration" />
            <Metric icon={Gauge} label="Completion rate" value={`${c.completionRate}%`}
              hint="Viewings that reached 90%"
              current={c.completionRate} previous={p.completionRate} compare={compare} testId="stat-completion-rate" />
            <Metric icon={Percent} label="Click-through rate" value={`${c.ctr}%`}
              hint="Clicks per view"
              current={c.ctr} previous={p.ctr} compare={compare} testId="stat-ctr" />
            <Metric icon={MousePointerClick} label="Avg. clicks" value={num(c.avg.clicksPerVideo)}
              hint={`Per video, ${num(c.clicks)} in total`}
              current={c.avg.clicksPerVideo} previous={p.avg.clicksPerVideo} compare={compare} testId="stat-avg-clicks" />
            <Metric icon={Repeat2} label="Avg. reposts" value={num(c.avg.repostsPerVideo)}
              hint={`Per video, ${c.repostsByBrand} brand, ${c.repostsByPublisher} Publisher`}
              current={c.avg.repostsPerVideo} previous={p.avg.repostsPerVideo} compare={compare} testId="stat-avg-reposts" />
            <Metric icon={Target} label="Conversion rate" value={`${c.conversionRate}%`}
              hint="Sales per click"
              current={c.conversionRate} previous={p.conversionRate} compare={compare} testId="stat-conversion-rate" />
            <Metric icon={DollarSign} label="Avg. sales value" value={fmt.exact(c.avg.grossPerVideoCents)}
              hint={c.sales.total > 0 ? `Per video, avg. order ${fmt.exact(c.avg.orderValueCents)}` : "No sales yet in this period"}
              current={c.avg.grossPerVideoCents} previous={p.avg.grossPerVideoCents} compare={compare} testId="stat-avg-gross" />
            <Metric icon={Users} label="Avg. audience sales" value={num(c.avg.ownSalesPerVideo)} hint={`Your own audience, ${c.sales.own} in total`}
              current={c.avg.ownSalesPerVideo} previous={p.avg.ownSalesPerVideo} compare={compare} testId="stat-avg-own-sales" />
            <Metric icon={ShoppingBag} label="Avg. Publisher sales" value={num(c.avg.publisherSalesPerVideo)} hint={`From Publishers, ${c.sales.publisher} in total`}
              current={c.avg.publisherSalesPerVideo} previous={p.avg.publisherSalesPerVideo} compare={compare} testId="stat-avg-publisher-sales" />
            <Metric icon={Store} label="Avg. brand sales" value={num(c.avg.brandSalesPerVideo)} hint={`From brand reposts, ${c.sales.brand} in total`}
              current={c.avg.brandSalesPerVideo} previous={p.avg.brandSalesPerVideo} compare={compare} testId="stat-avg-brand-sales" />
            <Metric icon={Wallet} label="Commission earned" value={fmt.exact(c.commissionCents)} hint="Before payout"
              current={c.commissionCents} previous={p.commissionCents} compare={compare} testId="stat-commission" />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <TrendChart series={data.series} bucket={data.period.bucket} money={fmt.whole} />
            <SourcesDonut sales={c.sales} prevTotal={p.sales.total} compare={compare} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <TopProductsCard products={data.topProducts} money={fmt} />
            <ViewSourcesCard sources={data.viewSources} />
          </div>

          <EarningsCard d={data} money={fmt} />
          <VideoTable d={data} money={fmt} />
        </>
      )}
    </section>
  );
}
