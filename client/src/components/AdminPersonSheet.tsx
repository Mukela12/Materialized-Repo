/**
 * Admin: one person's one-pager, opened from People in the Activity tab
 * (client, 24 Oct 2026: "should the users be clicked on to reveal a one-pager
 * with their stats and charts?"). Headline numbers first, then 30-day trends,
 * then the detail: videos, recent pages, the onboarding emails they've had.
 * Fed by server/activity.ts personReport.
 */
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Mail, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

interface PersonReport {
  person: {
    id: string; email: string; display_name: string; role: string; created_at: string | null;
    last_login_at: string | null; last_seen_at: string | null; login_count: number; free_access_until: string | null;
    email_opt_out_at: string | null; source: string; subscribed_at: string | null; plan: string | null;
    brand_name: string | null; journey: string | null;
  };
  totals: {
    videos: number; views: number; clicks: number; revenue: number; brands_tagged: number; page_views: number;
    invitesSent: number; invitesJoined: number; products: number;
  };
  daily: { day: string; views: number; clicks: number; visits: number }[];
  videos: { id: string; title: string; status: string; created_at: string; views: number; clicks: number; revenue: number; brands: number }[];
  pages: { path: string; at: string; device: string | null }[];
  emails: { subject: string; position: number; at: string }[];
}

const ROLE: Record<string, string> = { creator: "Creator", brand: "Brand", affiliate: "Publisher" };
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-2 text-center">
      <p className="text-base font-semibold tabular-nums truncate">{value}</p>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

function Trend({ title, data, dataKey, kind, total }: {
  title: string; data: PersonReport["daily"]; dataKey: "views" | "clicks" | "visits"; kind: "area" | "bar"; total: number;
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="text-sm font-semibold tabular-nums">{total.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">in 30 days</span></p>
      </div>
      <div className="h-24 mt-1">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "area" ? (
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="day" hide />
              <Tooltip
                formatter={(v: number) => [v, title]}
                labelFormatter={(d: string) => format(new Date(d), "d MMM")}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Area type="monotone" dataKey={dataKey} stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="day" hide />
              <Tooltip
                formatter={(v: number) => [v, title]}
                labelFormatter={(d: string) => format(new Date(d), "d MMM")}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey={dataKey} fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0] ? format(new Date(data[0].day), "d MMM") : ""}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

export function PersonSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<PersonReport>({
    queryKey: ["/api/admin/activity/people", userId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/activity/people/${userId}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
  });
  const p = data?.person;
  const t = data?.totals;
  const sum = (k: "views" | "clicks" | "visits") => (data?.daily ?? []).reduce((n, d) => n + d[k], 0);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-0" data-testid="person-sheet">
        {isError ? (
          <p className="p-6 text-sm text-muted-foreground">This person couldn't be loaded.</p>
        ) : isLoading || !p || !t ? (
          <div className="flex justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="pb-8">
            <SheetHeader className="px-5 pt-5 pb-4 border-b text-left">
              <SheetTitle className="text-lg leading-tight pr-6">{p.display_name}</SheetTitle>
              <SheetDescription className="text-xs">
                {p.email} · {ROLE[p.role] ?? p.role}{p.brand_name ? ` · ${p.brand_name}` : ""}
              </SheetDescription>
              <div className="flex flex-wrap gap-1.5 pt-2">
                <Badge variant="outline" className="font-normal">Source: {p.source}</Badge>
                <Badge variant="outline" className="font-normal">Joined {p.created_at ? format(new Date(p.created_at), "d MMM yyyy") : "unknown"}</Badge>
                <Badge variant={p.subscribed_at ? "default" : "outline"} className="font-normal">
                  {p.subscribed_at ? `Subscribed ${format(new Date(p.subscribed_at), "d MMM yyyy")}${p.plan ? ` · ${p.plan}` : ""}` : "Not subscribed"}
                </Badge>
                {p.free_access_until && new Date(p.free_access_until) > new Date() && (
                  <Badge variant="outline" className="font-normal">Free until {format(new Date(p.free_access_until), "d MMM")}</Badge>
                )}
              </div>
            </SheetHeader>

            <div className="px-5 pt-4 space-y-5">
              <div className="grid grid-cols-4 gap-1.5" data-testid="person-stats">
                <Stat label="Videos" value={t.videos} />
                <Stat label="Views" value={t.views.toLocaleString()} />
                <Stat label="Product clicks" value={t.clicks.toLocaleString()} />
                <Stat label="Sales" value={money(t.revenue)} />
                <Stat label="Brands tagged" value={t.brands_tagged} />
                <Stat label="Sign-ins" value={p.login_count} />
                <Stat label="Invites sent" value={t.invitesSent} />
                <Stat label="Invites joined" value={t.invitesJoined} />
              </div>
              <p className="text-xs text-muted-foreground -mt-3">
                Last seen {p.last_seen_at ? formatDistanceToNow(new Date(p.last_seen_at), { addSuffix: true }) : "never"}
                {p.last_login_at ? ` · last signed in ${formatDistanceToNow(new Date(p.last_login_at), { addSuffix: true })}` : ""}
              </p>

              <div className="space-y-2" data-testid="person-trends">
                <Trend title="Views of their videos" data={data!.daily} dataKey="views" kind="area" total={sum("views")} />
                <Trend title="Product clicks" data={data!.daily} dataKey="clicks" kind="bar" total={sum("clicks")} />
                <Trend title="Their visits to MTRLZD" data={data!.daily} dataKey="visits" kind="bar" total={sum("visits")} />
              </div>

              <section>
                <h3 className="text-sm font-semibold mb-2">Videos</h3>
                {data!.videos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No videos yet.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {data!.videos.map((v) => (
                      <li key={v.id} className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug line-clamp-2">{v.title}</p>
                          <Badge variant="secondary" className="shrink-0 text-[10px]">{v.status}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                          {v.views} views · {v.clicks} clicks · {v.views ? Math.round((v.clicks / v.views) * 1000) / 10 : 0}% click rate · {money(v.revenue)} · {v.brands} brand{v.brands === 1 ? "" : "s"} tagged
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold mb-2">Recent pages</h3>
                {data!.pages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No visits recorded yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {data!.pages.map((pg, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="font-mono truncate">{pg.path}</span>
                        <span className="shrink-0 text-muted-foreground">{formatDistanceToNow(new Date(pg.at), { addSuffix: true })}{pg.device ? ` · ${pg.device}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Onboarding emails</h3>
                {p.email_opt_out_at && <p className="text-xs text-amber-600 mb-1.5">Unsubscribed from these emails.</p>}
                {data!.emails.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{p.journey ? "None sent yet." : "Not in a journey."}</p>
                ) : (
                  <ul className="space-y-1">
                    {data!.emails.map((e, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate">{e.subject}</span>
                        <span className="shrink-0 text-muted-foreground">{format(new Date(e.at), "d MMM")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
