import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, differenceInDays, addDays, subDays, subYears } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, ChevronRight, Video, TrendingUp, RefreshCw, XCircle } from "lucide-react";
import type { Campaign } from "@shared/schema";

const CAMPAIGN_TOTAL_DAYS = 60;

const PERIODS = [
  { label: "1D", days: 1 },
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "60D", days: 60 },
  { label: "1Y", days: 365 },
] as const;
type PeriodLabel = typeof PERIODS[number]["label"];

const CURRENCIES = [
  { symbol: "€", code: "EUR", rate: 1 },
  { symbol: "$", code: "USD", rate: 1.08 },
  { symbol: "£", code: "GBP", rate: 0.85 },
] as const;
type CurrencyCode = typeof CURRENCIES[number]["code"];

function daysRemaining(campaign: Campaign): number {
  if (!campaign.startDate) return CAMPAIGN_TOTAL_DAYS;
  const totalDays = (campaign as any).totalDays ?? CAMPAIGN_TOTAL_DAYS;
  const end = addDays(new Date(campaign.startDate), totalDays);
  return Math.max(0, differenceInDays(end, new Date()));
}

function affiliateFees(campaign: Campaign): number {
  return parseFloat((campaign as any).affiliateFeesDue ?? campaign.spentAmount ?? "0");
}

function netValue(campaign: Campaign): number {
  return parseFloat(campaign.actualRevenue ?? "0") - affiliateFees(campaign);
}

function isWithinPeriod(campaign: Campaign, days: number): boolean {
  if (!campaign.startDate) return false;
  const cutoff = subDays(new Date(), days);
  return new Date(campaign.startDate) >= cutoff;
}

function CampaignCard({
  campaign,
  onClick,
  currencySymbol,
  currencyRate,
}: {
  campaign: Campaign;
  onClick: () => void;
  currencySymbol: string;
  currencyRate: number;
}) {
  const rem = daysRemaining(campaign);
  const total = (campaign as any).totalDays ?? CAMPAIGN_TOTAL_DAYS;
  const pct = Math.max(0, Math.min(100, ((total - rem) / total) * 100));
  const isExpired = campaign.status === "completed" || campaign.status === "cancelled" || rem === 0;
  const gross = parseFloat(campaign.actualRevenue ?? "0") * currencyRate;
  const fees = affiliateFees(campaign) * currencyRate;
  const net = gross - fees;

  return (
    <div
      data-testid={`card-campaign-${campaign.id}`}
      onClick={onClick}
      className="bg-card border border-border rounded-2xl p-5 cursor-pointer hover:border-primary/60 hover:bg-muted/30 transition-all group"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Video size={18} className="text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm leading-tight">{campaign.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {campaign.startDate
                ? `Launched ${format(new Date(campaign.startDate), "d MMM yyyy")}`
                : "Not started"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className={`text-[10px] px-2 py-0.5 rounded-full border-0 font-medium ${
              isExpired ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
            }`}
          >
            {isExpired ? "Expired" : "Active"}
          </Badge>
          <ChevronRight size={16} className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[11px] text-muted-foreground">Day {total - rem} of {total}</span>
          <span className="text-[11px] font-medium text-foreground/70">
            {rem > 0 ? `${rem} days remaining` : "Ended"}
          </span>
        </div>
        <Progress
          value={pct}
          className="h-1.5"
          data-testid={`progress-campaign-${campaign.id}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-muted/40 rounded-xl p-3 flex items-center gap-2">
          <RefreshCw size={12} className="text-muted-foreground shrink-0" />
          <div>
            <div className="text-xs font-semibold text-foreground">{(campaign as any).repostCount ?? 0}</div>
            <div className="text-[10px] text-muted-foreground">Reposts</div>
          </div>
        </div>
        <div className="bg-muted/40 rounded-xl p-3 flex items-center gap-2">
          <TrendingUp size={12} className="text-muted-foreground shrink-0" />
          <div>
            <div className="text-xs font-semibold text-foreground">{campaign.actualConversions ?? 0}</div>
            <div className="text-[10px] text-muted-foreground">Units Sold</div>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-3 grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-foreground/80">{currencySymbol}{gross.toFixed(2)}</span>
          <span className="text-[10px] text-muted-foreground mt-0.5">Gross Value</span>
        </div>
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-red-500 dark:text-red-400">{currencySymbol}{fees.toFixed(2)}</span>
          <span className="text-[10px] text-muted-foreground mt-0.5">Affiliate Fees</span>
        </div>
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{currencySymbol}{Math.abs(net).toFixed(2)}</span>
          <span className="text-[10px] text-muted-foreground mt-0.5">Net Earned</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
        <Play size={24} className="text-muted-foreground/40" />
      </div>
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  );
}

function MetricChip({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "red" | "default";
}) {
  const valColor =
    accent === "green" ? "text-emerald-600 dark:text-emerald-400" :
    accent === "red" ? "text-red-500 dark:text-red-400" :
    "text-foreground";
  return (
    <div className="bg-muted/40 border border-border/50 rounded-2xl p-3 flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground leading-tight">{label}</span>
      <span className={`text-base font-bold leading-tight ${valColor}`}>{value}</span>
      {sub && <span className="text-[9px] text-muted-foreground/60 leading-tight">{sub}</span>}
    </div>
  );
}

export default function BrandCampaigns() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"active" | "expired">("active");
  const [period, setPeriod] = useState<PeriodLabel>("60D");
  const [currencyIdx, setCurrencyIdx] = useState(0);

  const currency = CURRENCIES[currencyIdx];
  const periodDays = PERIODS.find((p) => p.label === period)!.days;

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
  });

  const periodCampaigns = useMemo(
    () => campaigns.filter((c) => isWithinPeriod(c, periodDays)),
    [campaigns, periodDays]
  );

  const active = campaigns.filter(
    (c) => c.status === "active" || c.status === "paused" || c.status === "draft"
  );
  const expired = campaigns.filter(
    (c) => c.status === "completed" || c.status === "cancelled"
  );

  const inactivePeriod = periodCampaigns.filter(
    (c) => c.status === "completed" || c.status === "cancelled" || daysRemaining(c) === 0
  );
  const activePeriod = periodCampaigns.filter(
    (c) => c.status !== "completed" && c.status !== "cancelled" && daysRemaining(c) > 0
  );

  const totalReposts = periodCampaigns.reduce((s, c) => s + ((c as any).repostCount ?? 0), 0);
  const totalUnits = periodCampaigns.reduce((s, c) => s + (c.actualConversions ?? 0), 0);
  const totalGross = periodCampaigns.reduce((s, c) => s + parseFloat(c.actualRevenue ?? "0"), 0) * currency.rate;
  const totalNet = periodCampaigns.reduce((s, c) => s + netValue(c), 0) * currency.rate;

  const cycleCurrency = () => setCurrencyIdx((i) => (i + 1) % CURRENCIES.length);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Video-linked campaigns with publisher performance</p>
        </div>
        <Button
          data-testid="button-new-campaign"
          size="sm"
          onClick={() => navigate("/brand/campaigns/new")}
          className="rounded-full text-xs px-4 h-8"
        >
          + New
        </Button>
      </div>

      {/* Period + Currency controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-1 flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p.label}
              data-testid={`period-${p.label}`}
              onClick={() => setPeriod(p.label)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
                period === p.label
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          data-testid="button-currency"
          onClick={cycleCurrency}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/60 border border-border text-[11px] font-semibold text-foreground/70 hover:bg-muted hover:text-foreground transition-all shrink-0"
        >
          <span className="text-sm">{currency.symbol}</span>
          <span>{currency.code}</span>
        </button>
      </div>

      {/* Metrics grid */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <MetricChip label="# Active" value={activePeriod.length} />
          <MetricChip label="# Inactive" value={inactivePeriod.length} />
          <MetricChip label="# Reposts" value={totalReposts} />
          <MetricChip label="Units Sold" value={totalUnits} />
          <MetricChip
            label="Gross Value"
            value={`${currency.symbol}${totalGross.toFixed(0)}`}
            accent="default"
          />
          <MetricChip
            label="Net Value"
            value={`${currency.symbol}${totalNet.toFixed(0)}`}
            accent="green"
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "expired")}>
        <TabsList
          className="border border-border rounded-2xl p-1 mb-2 w-full h-10"
          data-testid="tabs-campaign-status"
        >
          <TabsTrigger
            value="active"
            data-testid="tab-active"
            className="flex-1 rounded-xl text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground transition-all"
          >
            Active <span className="ml-1.5 opacity-60">({active.length})</span>
          </TabsTrigger>
          <TabsTrigger
            value="expired"
            data-testid="tab-expired"
            className="flex-1 rounded-xl text-xs data-[state=active]:bg-secondary data-[state=active]:text-secondary-foreground text-muted-foreground transition-all"
          >
            Expired <span className="ml-1.5 opacity-60">({expired.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-4">
          {isLoading ? (
            <>
              <Skeleton className="h-52 rounded-2xl" />
              <Skeleton className="h-52 rounded-2xl" />
            </>
          ) : active.length === 0 ? (
            <EmptyState label="No active campaigns yet. Launch one to get started." />
          ) : (
            active.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onClick={() => navigate(`/brand/campaigns/${c.id}`)}
                currencySymbol={currency.symbol}
                currencyRate={currency.rate}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="expired" className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-52 rounded-2xl" />
          ) : expired.length === 0 ? (
            <EmptyState label="No expired campaigns yet." />
          ) : (
            expired.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onClick={() => navigate(`/brand/campaigns/${c.id}`)}
                currencySymbol={currency.symbol}
                currencyRate={currency.rate}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
