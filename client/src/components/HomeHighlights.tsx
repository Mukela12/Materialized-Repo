/**
 * The first thing every account sees on its homepage (client, 18 Nov 2026):
 * this month's views, click-through rate and the money its videos made, then
 * its three best videos with their numbers. Same counting and colours as the
 * Analytics dashboard (GET /api/dashboard/performance, month to date in US
 * dollars), each account scoped to its own results.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, DollarSign, Eye, Percent, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Metric, TONES, moneyFormat, num } from "@/components/CreatorDashboard";
import type { CreatorDashboard as Dashboard, DashboardAudience, DashboardVideoRow } from "@shared/creatorDashboard";

const DAY = 86_400_000;

const COPY: Record<DashboardAudience, { sales: string; salesHint: string; commission: string; commissionHint: string; analytics: string; empty: string }> = {
  creator: {
    sales: "Attributed sales", salesHint: "What your videos sold",
    commission: "Commission earned", commissionHint: "Before payout",
    analytics: "/creator/analytics",
    empty: "Your best videos show here once they get views this month.",
  },
  brand: {
    sales: "Affiliate sales", salesHint: "Your orders from creator videos",
    commission: "Commission paid", commissionHint: "To creators and Publishers",
    analytics: "/brand/analytics",
    empty: "Your best videos show here once videos with your products get views this month.",
  },
  publisher: {
    sales: "Sales value", salesHint: "Orders from your pages",
    commission: "Commission earned", commissionHint: "Before payout",
    analytics: "/affiliate/analytics",
    empty: "Your best videos show here once the videos on your pages get views this month.",
  },
};

/** The first of this month (UTC) to now. */
function monthToDate(now = new Date()) {
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
}

function VideoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function TopVideo({ v, rank, audience, money }: { v: DashboardVideoRow; rank: number; audience: DashboardAudience; money: (c: number) => string }) {
  const tone = TONES[rank % TONES.length];
  return (
    <li
      className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:gap-5 md:px-5"
      style={{ ["--tl" as string]: tone.l, ["--td" as string]: tone.d }}
      data-testid={`home-top-video-${rank}`}
    >
      <div className="flex min-w-0 items-center gap-3 md:w-[38%] md:shrink-0">
        <span className="w-4 shrink-0 text-center text-sm font-semibold tabular-nums text-[color:var(--tl)] dark:text-[color:var(--td)]">{rank + 1}</span>
        {v.thumbnailUrl
          ? <img src={v.thumbnailUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" loading="lazy" />
          : <div className="h-11 w-11 shrink-0 rounded-lg bg-muted" />}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{v.title}</p>
          {audience !== "creator" && v.creatorName && <p className="truncate text-[11px] text-muted-foreground">{v.creatorName}</p>}
        </div>
      </div>
      <dl className={`grid flex-1 gap-x-3 gap-y-2 pl-7 md:pl-0 ${audience === "publisher" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3 sm:grid-cols-5"}`}>
        <VideoStat label="Views" value={num(v.views)} />
        <VideoStat label="CTR" value={`${v.ctr}%`} />
        <VideoStat label="Sales value" value={money(v.grossCents)} />
        {audience !== "publisher" && <VideoStat label="Reposts" value={num(v.reposts)} />}
        <VideoStat label={audience === "brand" ? "Commission paid" : "Commission"} value={money(v.commissionCents)} />
      </dl>
    </li>
  );
}

export function HomeHighlights({ audience }: { audience: DashboardAudience }) {
  const copy = COPY[audience];
  // Fixed for the page's life, so the query key does not change every render.
  const range = useMemo(() => monthToDate(), []);
  const url = `/api/dashboard/performance?${new URLSearchParams({
    as: audience, from: range.from.toISOString(), to: range.to.toISOString(), currency: "usd",
  }).toString()}`;
  const { data, isLoading, isError } = useQuery<Dashboard>({ queryKey: [url] });
  const money = useMemo(() => moneyFormat(data?.currency ?? "usd").exact, [data?.currency]);
  const days = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / DAY));
  const compare = `prior ${days} ${days === 1 ? "day" : "days"}`;
  const monthName = range.from.toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });

  const c = data?.current;
  const p = data?.previous;
  const top = (data?.videos ?? []).filter((v) => v.views > 0 || v.sales.total > 0 || v.commissionCents > 0).slice(0, 3);

  return (
    <section className="space-y-3" aria-labelledby="home-highlights-heading" data-testid="section-home-highlights">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-highlights-heading" className="text-base font-semibold tracking-tight">{monthName} so far</h2>
        <Link href={copy.analytics} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" data-testid="link-home-analytics">
          All analytics
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {isError && !data ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">This month's numbers could not load. Try again in a moment.</CardContent></Card>
      ) : isLoading || !c || !p ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[112px] rounded-xl" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric icon={Eye} label="Views" value={num(c.views)} hint="This month"
              current={c.views} previous={p.views} compare={compare} testId="home-stat-views" tone={TONES[0]} />
            <Metric icon={Percent} label="Click-through rate" value={`${c.ctr}%`} hint="Clicks per view"
              current={c.ctr} previous={p.ctr} compare={compare} testId="home-stat-ctr" tone={TONES[3]} ring={c.ctr} />
            <Metric icon={DollarSign} label={copy.sales} value={money(c.grossCents)}
              hint={c.sales.total > 0 ? `${c.sales.total} ${c.sales.total === 1 ? "sale" : "sales"}` : copy.salesHint}
              current={c.grossCents} previous={p.grossCents} compare={compare} testId="home-stat-sales" tone={TONES[4]} />
            <Metric icon={Wallet} label={copy.commission} value={money(c.commissionCents)} hint={copy.commissionHint}
              current={c.commissionCents} previous={p.commissionCents} compare={compare} testId="home-stat-commission" tone={TONES[1]} />
          </div>

          <Card className="min-w-0">
            <CardContent className="p-0">
              <p className="px-4 pt-4 text-[12px] font-medium text-muted-foreground md:px-5">Top videos this month</p>
              {top.length === 0 ? (
                <p className="px-4 pb-5 pt-2 text-sm text-muted-foreground md:px-5" data-testid="text-home-top-empty">{copy.empty}</p>
              ) : (
                <ol className="mt-1 divide-y" data-testid="list-home-top-videos">
                  {top.map((v, i) => <TopVideo key={v.videoId} v={v} rank={i} audience={audience} money={money} />)}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
