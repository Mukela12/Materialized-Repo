import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/StatCard";
import { AffiliateTable } from "@/components/AffiliateTable";
import { AffiliatePublishersTable } from "@/components/AffiliatePublishersTable";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  Eye,
  MousePointer,
  DollarSign,
  TrendingUp,
  Download,
  BarChart3,
  Globe,
  Smartphone,
  Monitor,
  Users,
  ShoppingCart,
  Percent,
  Package,
  Clock,
  ExternalLink,
  Link2,
} from "lucide-react";
import type { Video } from "@shared/schema";

const CURRENCIES: { code: string; symbol: string; rate: number }[] = [
  { code: "USD", symbol: "$", rate: 1 },
  { code: "EUR", symbol: "€", rate: 0.92 },
  { code: "GBP", symbol: "£", rate: 0.79 },
  { code: "AUD", symbol: "A$", rate: 1.53 },
  { code: "CAD", symbol: "C$", rate: 1.36 },
  { code: "JPY", symbol: "¥", rate: 149.5 },
  { code: "SGD", symbol: "S$", rate: 1.34 },
  { code: "CHF", symbol: "CHF ", rate: 0.88 },
];

interface EmbedTrace {
  utmCode: string;
  videoTitle: string;
  publisherName: string;
  referrerDomain: string;
  referrerUrl: string;
  totalLoads: number;
  totalClicks: number;
  totalConversions: number;
  revenue: number;
}

interface DetailedStats {
  totalViews: number;
  totalClicks: number;
  totalRevenue: number;
  averageCTR: number;
  topCountries: { country: string; views: number; avgSpend: number }[];
  deviceBreakdown: { device: string; percentage: number }[];
  viewsByDay: { date: string; views: number }[];
  viewsByHour: { hour: number; views: number }[];
  ageBreakdown: { range: string; percentage: number }[];
  genderBreakdown: { male: number; female: number; other: number };
  averageSpend: number;
  salesConversionRate: number;
  salesVolumeUnits: number;
  salesVolumeValue: number;
  embedTraces?: EmbedTrace[];
  isPublisherView?: boolean;
}

function formatCurrency(value: number, symbol: string, code: string) {
  if (code === "JPY") return `${symbol}${Math.round(value).toLocaleString()}`;
  return `${symbol}${value.toFixed(2)}`;
}

type DashboardContext = "creator" | "brand" | "publisher";

function useDashboardContext(): DashboardContext {
  const [location] = useLocation();
  if (location.startsWith("/brand")) return "brand";
  if (location.startsWith("/affiliate")) return "publisher";
  return "creator";
}

function getApiEndpoint(context: DashboardContext) {
  switch (context) {
    case "brand": return "/api/analytics/brand-detailed";
    case "publisher": return "/api/analytics/publisher-detailed";
    default: return "/api/analytics/detailed";
  }
}

function getPageTitle(context: DashboardContext) {
  switch (context) {
    case "brand": return "Brand Analytics";
    case "publisher": return "Publisher Analytics";
    default: return "Analytics";
  }
}

function getPageSubtitle(context: DashboardContext) {
  switch (context) {
    case "brand": return "Track product performance across all creator videos and publishing sources";
    case "publisher": return "Track performance from your embedded video codes";
    default: return "Track your video performance and revenue metrics";
  }
}

export default function Analytics() {
  const dashboardContext = useDashboardContext();
  const [currency, setCurrency] = useState("USD");
  const [timeRange, setTimeRange] = useState<"7" | "30" | "90">("30");

  const currencyInfo = CURRENCIES.find((c) => c.code === currency) || CURRENCIES[0];
  const convert = (usd: number) => usd * currencyInfo.rate;
  const fmtCurrency = (usd: number) => formatCurrency(convert(usd), currencyInfo.symbol, currencyInfo.code);

  const apiEndpoint = getApiEndpoint(dashboardContext);

  const { data: videos = [], isLoading: videosLoading } = useQuery<Video[]>({
    queryKey: ["/api/videos"],
  });

  const { data: stats } = useQuery<DetailedStats>({
    queryKey: [apiEndpoint],
  });

  const defaultStats: DetailedStats = {
    totalViews: 0,
    totalClicks: 0,
    totalRevenue: 0,
    averageCTR: 0,
    topCountries: [],
    deviceBreakdown: [
      { device: "Mobile", percentage: 62 },
      { device: "Desktop", percentage: 31 },
      { device: "Tablet", percentage: 7 },
    ],
    viewsByDay: [],
    viewsByHour: [],
    ageBreakdown: [],
    genderBreakdown: { male: 0, female: 0, other: 0 },
    averageSpend: 0,
    salesConversionRate: 0,
    salesVolumeUnits: 0,
    salesVolumeValue: 0,
    embedTraces: [],
  };

  const currentStats = stats || defaultStats;
  const embedTraces = currentStats.embedTraces || [];
  const isPublisherView = dashboardContext === "publisher";

  const filteredViewsByDay = useMemo(() => {
    const days = parseInt(timeRange);
    return currentStats.viewsByDay.slice(-days);
  }, [currentStats.viewsByDay, timeRange]);

  const showAffiliateTable = dashboardContext === "creator";

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight" data-testid="text-analytics-title">
            {getPageTitle(dashboardContext)}
          </h1>
          <p className="text-muted-foreground mt-1">
            {getPageSubtitle(dashboardContext)}
          </p>
          {isPublisherView && (
            <Badge variant="secondary" className="mt-2" data-testid="badge-publisher-scope">
              <Link2 className="h-3 w-3 mr-1" />
              Showing only your embed code data
            </Badge>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <Select value={currency} onValueChange={setCurrency} data-testid="select-currency">
            <SelectTrigger className="w-[120px]" data-testid="select-currency-trigger">
              <SelectValue placeholder="Currency" />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code} data-testid={`select-currency-${c.code}`}>
                  {c.code} ({c.symbol.trim()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" data-testid="button-download">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={isPublisherView ? "My Views" : "Total Views"}
          value={currentStats.totalViews.toLocaleString()}
          subtitle={isPublisherView ? "From your embeds" : "All-time video views"}
          icon={Eye}
        />
        <StatCard
          title={isPublisherView ? "My Clicks" : "Total Clicks"}
          value={currentStats.totalClicks.toLocaleString()}
          subtitle={isPublisherView ? "From your embeds" : "Product interactions"}
          icon={MousePointer}
        />
        <StatCard
          title={isPublisherView ? "My Revenue" : "Revenue"}
          value={fmtCurrency(currentStats.totalRevenue)}
          subtitle={isPublisherView ? "Your earnings" : "Total earnings"}
          icon={DollarSign}
        />
        <StatCard
          title="Avg. CTR"
          value={`${currentStats.averageCTR.toFixed(2)}%`}
          subtitle="Click-through rate"
          icon={TrendingUp}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Average Spend"
          value={fmtCurrency(currentStats.averageSpend)}
          subtitle="Per transaction"
          icon={ShoppingCart}
        />
        <StatCard
          title="Conversion Rate"
          value={`${currentStats.salesConversionRate}%`}
          subtitle="Sales conversion"
          icon={Percent}
        />
        <StatCard
          title="Sales Volume"
          value={currentStats.salesVolumeUnits.toLocaleString()}
          subtitle="Units sold"
          icon={Package}
        />
        <StatCard
          title="Sales Value"
          value={fmtCurrency(currentStats.salesVolumeValue)}
          subtitle="Total sales value"
          icon={DollarSign}
        />
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="audience" data-testid="tab-audience">Audience</TabsTrigger>
          <TabsTrigger value="sources" data-testid="tab-sources">Publishing Sources</TabsTrigger>
          {showAffiliateTable && (
            <>
              <TabsTrigger value="videos" data-testid="tab-videos">By Video</TabsTrigger>
              <TabsTrigger value="affiliates" data-testid="tab-affiliates">Affiliates</TabsTrigger>
            </>
          )}
          <TabsTrigger value="geography" data-testid="tab-geography">Geography</TabsTrigger>
          <TabsTrigger value="devices" data-testid="tab-devices">Devices</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  {isPublisherView ? "Views from Your Embeds" : "Views by Date"}
                </CardTitle>
                <div className="flex gap-1">
                  {(["7", "30", "90"] as const).map((range) => (
                    <Button
                      key={range}
                      variant={timeRange === range ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTimeRange(range)}
                      data-testid={`button-range-${range}`}
                    >
                      {range}d
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredViewsByDay.length > 0 ? (
                <div className="h-72" data-testid="chart-views-by-day">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={filteredViewsByDay}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d: string) => {
                          const date = new Date(d);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                        fontSize={12}
                        className="fill-muted-foreground"
                        interval={timeRange === "7" ? 0 : timeRange === "30" ? 4 : 13}
                      />
                      <YAxis fontSize={12} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}
                        labelFormatter={(d: string) => new Date(d).toLocaleDateString()}
                      />
                      <Bar dataKey="views" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center bg-muted/30 rounded-lg">
                  <div className="text-center text-muted-foreground">
                    <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No view data yet</p>
                    <p className="text-sm">Upload videos to start tracking performance</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {showAffiliateTable && <AffiliateTable videos={videos} isLoading={videosLoading} formatMoney={fmtCurrency} />}
        </TabsContent>

        <TabsContent value="audience" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Age Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3" data-testid="chart-age-breakdown">
                  {currentStats.ageBreakdown.map((age) => (
                    <div key={age.range} className="flex items-center gap-3" data-testid={`row-age-${age.range}`}>
                      <span className="text-sm text-muted-foreground w-12 text-right">{age.range}</span>
                      <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full flex items-center justify-end pr-2 transition-all"
                          style={{ width: `${Math.max(age.percentage, 5)}%` }}
                        >
                          {age.percentage >= 10 && (
                            <span className="text-xs font-medium text-primary-foreground">{age.percentage}%</span>
                          )}
                        </div>
                      </div>
                      {age.percentage < 10 && (
                        <span className="text-xs text-muted-foreground w-8">{age.percentage}%</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Gender Split
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6" data-testid="chart-gender-breakdown">
                  {[
                    { label: "Female", value: currentStats.genderBreakdown.female, color: "bg-pink-500" },
                    { label: "Male", value: currentStats.genderBreakdown.male, color: "bg-blue-500" },
                    { label: "Other", value: currentStats.genderBreakdown.other, color: "bg-purple-500" },
                  ].map((g) => (
                    <div key={g.label} className="space-y-2" data-testid={`row-gender-${g.label.toLowerCase()}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{g.label}</span>
                        <span className="text-2xl font-bold">{g.value}%</span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full ${g.color} rounded-full transition-all`}
                          style={{ width: `${g.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Peak Viewing Hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              {currentStats.viewsByHour.length > 0 ? (
                <div className="h-64" data-testid="chart-views-by-hour">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={currentStats.viewsByHour}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="hour"
                        tickFormatter={(h: number) => `${h}:00`}
                        fontSize={11}
                        className="fill-muted-foreground"
                      />
                      <YAxis fontSize={12} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}
                        labelFormatter={(h: number) => `${h}:00 - ${h + 1}:00`}
                      />
                      <Bar dataKey="views" radius={[3, 3, 0, 0]}>
                        {currentStats.viewsByHour.map((entry, index) => {
                          const maxViews = Math.max(...currentStats.viewsByHour.map((e) => e.views));
                          const intensity = entry.views / maxViews;
                          return (
                            <Cell
                              key={`cell-${index}`}
                              fill={`hsl(var(--primary) / ${0.3 + intensity * 0.7})`}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center bg-muted/30 rounded-lg">
                  <div className="text-center text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No hourly data yet</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                {isPublisherView ? "Your Embed Deployments" : "Publishing Sources & Embed Traces"}
              </CardTitle>
              {isPublisherView && (
                <p className="text-sm text-muted-foreground">
                  Performance data from your unique embed codes only
                </p>
              )}
            </CardHeader>
            <CardContent>
              {embedTraces.length > 0 ? (
                <div className="space-y-3" data-testid="list-embed-traces">
                  <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <div className="col-span-3">Video / Source</div>
                    <div className="col-span-2">UTM Code</div>
                    <div className="col-span-2 text-right">Views</div>
                    <div className="col-span-1 text-right">Clicks</div>
                    <div className="col-span-2 text-right">Conversions</div>
                    <div className="col-span-2 text-right">Revenue</div>
                  </div>
                  {embedTraces.map((trace, i) => (
                    <div
                      key={`${trace.utmCode}-${i}`}
                      className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                      data-testid={`row-embed-trace-${i}`}
                    >
                      <div className="md:col-span-3">
                        <p className="font-medium text-sm">{trace.videoTitle}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-xs text-muted-foreground">{trace.publisherName}</span>
                          <a
                            href={trace.referrerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-0.5"
                            data-testid={`link-source-${i}`}
                          >
                            {trace.referrerDomain}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                      <div className="md:col-span-2 flex items-center">
                        <Badge variant="outline" className="font-mono text-xs" data-testid={`badge-utm-${i}`}>
                          {trace.utmCode}
                        </Badge>
                      </div>
                      <div className="md:col-span-2 md:text-right flex md:block items-center gap-2">
                        <span className="md:hidden text-xs text-muted-foreground">Views:</span>
                        <span className="font-semibold" data-testid={`text-trace-views-${i}`}>{trace.totalLoads.toLocaleString()}</span>
                      </div>
                      <div className="md:col-span-1 md:text-right flex md:block items-center gap-2">
                        <span className="md:hidden text-xs text-muted-foreground">Clicks:</span>
                        <span className="text-sm" data-testid={`text-trace-clicks-${i}`}>{trace.totalClicks.toLocaleString()}</span>
                      </div>
                      <div className="md:col-span-2 md:text-right flex md:block items-center gap-2">
                        <span className="md:hidden text-xs text-muted-foreground">Conv:</span>
                        <span className="text-sm" data-testid={`text-trace-conversions-${i}`}>{trace.totalConversions}</span>
                      </div>
                      <div className="md:col-span-2 md:text-right flex md:block items-center gap-2">
                        <span className="md:hidden text-xs text-muted-foreground">Rev:</span>
                        <span className="font-semibold text-sm" data-testid={`text-trace-revenue-${i}`}>
                          {fmtCurrency(trace.revenue)}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 rounded-lg bg-muted/50 font-semibold">
                    <div className="md:col-span-3 text-sm">
                      Total ({embedTraces.length} sources)
                    </div>
                    <div className="md:col-span-2" />
                    <div className="md:col-span-2 md:text-right" data-testid="text-traces-total-views">
                      {embedTraces.reduce((s, t) => s + t.totalLoads, 0).toLocaleString()}
                    </div>
                    <div className="md:col-span-1 md:text-right text-sm" data-testid="text-traces-total-clicks">
                      {embedTraces.reduce((s, t) => s + t.totalClicks, 0).toLocaleString()}
                    </div>
                    <div className="md:col-span-2 md:text-right text-sm" data-testid="text-traces-total-conversions">
                      {embedTraces.reduce((s, t) => s + t.totalConversions, 0)}
                    </div>
                    <div className="md:col-span-2 md:text-right text-sm" data-testid="text-traces-total-revenue">
                      {fmtCurrency(embedTraces.reduce((s, t) => s + t.revenue, 0))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Link2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No publishing sources tracked yet</p>
                  <p className="text-sm">Embed codes will appear here once deployed</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {showAffiliateTable && (
          <TabsContent value="videos">
            <AffiliateTable videos={videos} isLoading={videosLoading} formatMoney={fmtCurrency} />
          </TabsContent>
        )}

        {showAffiliateTable && (
          <TabsContent value="affiliates">
            <AffiliatePublishersTable formatMoney={fmtCurrency} />
          </TabsContent>
        )}

        <TabsContent value="geography" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Top Countries
              </CardTitle>
            </CardHeader>
            <CardContent>
              {currentStats.topCountries.length > 0 ? (
                <div className="space-y-4" data-testid="list-top-countries">
                  {currentStats.topCountries.map((country, i) => (
                    <div key={country.country} className="flex items-center gap-4" data-testid={`row-country-${i}`}>
                      <span className="text-lg font-bold text-muted-foreground w-6">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium">{country.country}</span>
                          <div className="flex gap-4 text-sm text-muted-foreground">
                            <span>{country.views.toLocaleString()} views</span>
                            <span className="font-medium text-foreground" data-testid={`text-avgspend-${i}`}>
                              {fmtCurrency(country.avgSpend)} avg
                            </span>
                          </div>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{
                              width: `${(country.views / currentStats.topCountries[0].views) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Globe className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No geographic data yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="devices" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {currentStats.deviceBreakdown.map((device) => {
              const Icon = device.device === "Mobile"
                ? Smartphone
                : device.device === "Desktop"
                ? Monitor
                : Smartphone;
              return (
                <Card key={device.device}>
                  <CardContent className="p-6 text-center">
                    <div className="h-12 w-12 mx-auto rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-3xl font-bold" data-testid={`text-device-${device.device.toLowerCase()}`}>{device.percentage}%</p>
                    <p className="text-muted-foreground mt-1">{device.device}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
