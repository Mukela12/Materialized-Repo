/**
 * Admin: who comes in, where they land and leave, who signs in, and what the
 * voucher codes handed out actually did. Fed by server/activity.ts.
 *
 * Built after hundreds of codes produced two sign-ups and nobody could say
 * whether the links had even been opened. Admin accounts are left out of every
 * figure. Visits before tracking began were never recorded, so the page says
 * when counting started rather than implying nothing happened before.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Activity, DoorOpen, LogIn, RefreshCw, Ticket, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableToolbar } from "@/components/TableToolbar";
import { useTableControls } from "@/hooks/useTableControls";
import { exportToCsv } from "@/lib/exportCsv";

interface Report {
  days: number;
  totals: {
    visitors: number; sessions: number; signups: number; logins: number;
    active_users: number; code_link_visitors: number; tracking_since: string | null;
  };
  landing: { path: string; sessions: number; bounced: number }[];
  exits: { path: string; sessions: number }[];
  devices: { device: string; sessions: number }[];
  codes: { batch: string; issued: number; live: number; opened: number; signed_up: number; came_back: number; last_signup: string | null }[];
  invites: { source: string; sent: number; signed_up: number }[];
  people: {
    id: string; email: string; display_name: string; role: string; created_at: string | null;
    last_login_at: string | null; last_seen_at: string | null; login_count: number;
    last_page: string | null; via_code: string | null;
  }[];
}

const WINDOWS = [7, 30, 90] as const;

const ROLE: Record<string, string> = { creator: "Creator", brand: "Brand", affiliate: "Publisher" };

/** "/" reads as nothing in a list; give the pages people know by name their name. */
function pageName(path: string): string {
  const named: Record<string, string> = {
    "/": "Home", "/register": "Sign up", "/login": "Log in", "/forgot-password": "Forgot password",
    "/privacy": "Privacy", "/cookies": "Cookies",
  };
  return named[path] ?? path;
}

function ago(at: string | null): string {
  return at ? formatDistanceToNow(new Date(at), { addSuffix: true }) : "Never";
}

function Tile({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number; hint?: string }) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <p className="text-xs truncate">{label}</p>
        </div>
        <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">{value.toLocaleString()}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** A ranked list with a bar behind each count: easy to read at a glance, on any width. */
function PageList({ rows, empty, extra }: {
  rows: { path: string; sessions: number; bounced?: number }[];
  empty: string;
  extra?: (r: { path: string; sessions: number; bounced?: number }) => string | null;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-2">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.sessions));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.path} className="relative rounded-md overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${(r.sessions / max) * 100}%` }} />
          <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5 text-sm">
            <span className="truncate font-mono text-xs" title={r.path}>{pageName(r.path)}</span>
            <span className="shrink-0 tabular-nums text-xs">
              {extra?.(r) && <span className="text-muted-foreground mr-2">{extra(r)}</span>}
              <span className="font-semibold">{r.sessions}</span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function pct(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : "";
}

export function AdminActivity() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<Report>({
    queryKey: ["/api/admin/activity", days],
    queryFn: async () => {
      const r = await fetch(`/api/admin/activity?days=${days}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
  });

  const people = data?.people ?? [];
  const { query, setQuery, rows } = useTableControls(people, {
    searchFields: (p) => [p.display_name, p.email, p.role, p.via_code ?? ""],
  });

  const exportPeople = () =>
    exportToCsv("activity-people", rows, [
      { header: "Name", value: (p) => p.display_name },
      { header: "Email", value: (p) => p.email },
      { header: "Role", value: (p) => ROLE[p.role] ?? p.role },
      { header: "Joined", value: (p) => (p.created_at ? format(new Date(p.created_at), "yyyy-MM-dd") : "") },
      { header: "Code", value: (p) => p.via_code ?? "" },
      { header: "Sign-ins", value: (p) => String(p.login_count) },
      { header: "Last sign-in", value: (p) => (p.last_login_at ? format(new Date(p.last_login_at), "yyyy-MM-dd HH:mm") : "") },
      { header: "Last seen", value: (p) => (p.last_seen_at ? format(new Date(p.last_seen_at), "yyyy-MM-dd HH:mm") : "") },
      { header: "Last page", value: (p) => p.last_page ?? "" },
    ]);

  if (isError && !data) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground" data-testid="activity-error">
        <p>Activity couldn't be loaded.</p>
        <button onClick={() => refetch()} className="mt-2 underline hover:text-foreground">Try again</button>
      </div>
    );
  }
  if (isLoading || !data) {
    return <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const t = data.totals;
  const since = t.tracking_since ? new Date(t.tracking_since) : null;
  const totalSessions = data.devices.reduce((n, d) => n + d.sessions, 0);

  return (
    <div className="space-y-6" data-testid="admin-activity">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-w-xl">
          {since
            ? <>Counting since {format(since, "d MMM yyyy")}. Earlier visits were not recorded. Admin accounts are left out.</>
            : <>Nothing recorded yet. Visits are counted from now on. Admin accounts are left out.</>}
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Period">
            {WINDOWS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                data-testid={`activity-window-${d}`}
                aria-pressed={days === d}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d} days
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
            data-testid="activity-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4" data-testid="activity-tiles">
        <Tile icon={Users} label="Visitors" value={t.visitors} hint={`${t.sessions} visits`} />
        <Tile icon={UserPlus} label="Sign-ups" value={t.signups} />
        <Tile icon={LogIn} label="Sign-ins" value={t.logins} />
        <Tile icon={Activity} label="Active accounts" value={t.active_users} hint="signed in and used the app" />
      </div>

      <Card data-testid="activity-codes">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><Ticket className="h-4 w-4" /> Voucher codes</CardTitle>
          <CardDescription>
            Every code batch, all time: how many were handed out, how many links were opened, how many became accounts,
            and how many of those came back a day or more later. "Opened" only counts links followed since counting began.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No codes issued yet.</p>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 pr-3 font-medium">Batch</th>
                      <th className="py-2 px-3 font-medium text-right">Issued</th>
                      <th className="py-2 px-3 font-medium text-right">Links opened</th>
                      <th className="py-2 px-3 font-medium text-right">Accounts</th>
                      <th className="py-2 px-3 font-medium text-right">Came back</th>
                      <th className="py-2 pl-3 font-medium">Last sign-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.codes.map((c) => (
                      <tr key={c.batch} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">{c.batch}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {c.issued}
                          {c.live < c.issued && <span className="text-xs text-muted-foreground"> ({c.issued - c.live} revoked)</span>}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{c.opened}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {c.signed_up} <span className="text-xs text-muted-foreground">{pct(c.signed_up, c.issued)}</span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{c.came_back}</td>
                        <td className="py-2 pl-3 text-muted-foreground">{c.last_signup ? format(new Date(c.last_signup), "d MMM yyyy") : "None yet"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="md:hidden divide-y rounded-lg border">
                {data.codes.map((c) => (
                  <li key={c.batch} className="p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-medium text-sm truncate">{c.batch}</p>
                      <p className="text-[11px] text-muted-foreground shrink-0">
                        {c.last_signup ? `last ${format(new Date(c.last_signup), "d MMM")}` : "no sign-ups"}
                      </p>
                    </div>
                    <div className="grid grid-cols-4 gap-1 mt-2 text-center">
                      {[["Issued", c.issued], ["Opened", c.opened], ["Joined", c.signed_up], ["Back", c.came_back]].map(([l, v]) => (
                        <div key={l as string} className="rounded-md bg-muted/50 py-1.5">
                          <p className="text-sm font-semibold tabular-nums">{v}</p>
                          <p className="text-[10px] text-muted-foreground">{l}</p>
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.invites.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {data.invites.map((i) => (
                <Badge key={i.source} variant="secondary" className="font-normal">
                  {i.source}: {i.sent} sent, {i.signed_up} joined
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card data-testid="activity-landing">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><DoorOpen className="h-4 w-4" /> Where visits start</CardTitle>
            <CardDescription>First page of each visit. "Left" means it was the only page they saw.</CardDescription>
          </CardHeader>
          <CardContent>
            <PageList
              rows={data.landing}
              empty="No visits in this period."
              extra={(r) => (r.bounced ? `${r.bounced} left` : null)}
            />
          </CardContent>
        </Card>
        <Card data-testid="activity-exits">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><DoorOpen className="h-4 w-4 -scale-x-100" /> Where visits end</CardTitle>
            <CardDescription>Last page seen, for visits of two pages or more.</CardDescription>
          </CardHeader>
          <CardContent>
            <PageList rows={data.exits} empty="No multi-page visits in this period." />
          </CardContent>
        </Card>
      </div>

      {data.devices.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="activity-devices">
          {data.devices.map((d) => (
            <Badge key={d.device} variant="outline" className="font-normal">
              {d.device[0].toUpperCase() + d.device.slice(1)}: {pct(d.sessions, totalSessions)} of visits
            </Badge>
          ))}
        </div>
      )}

      <Card data-testid="activity-people">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><Users className="h-4 w-4" /> People</CardTitle>
              <CardDescription>Every account, most recently seen first. Sign-ins are counted from {since ? format(since, "d MMM") : "now"}.</CardDescription>
            </div>
            <TableToolbar
              query={query}
              onQueryChange={setQuery}
              onExport={exportPeople}
              exportDisabled={rows.length === 0}
              searchPlaceholder="Search people…"
              data-testid="activity-people-toolbar"
            />
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{people.length === 0 ? "No accounts yet." : "No one matches that search."}</p>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 pr-3 font-medium">Person</th>
                      <th className="py-2 px-3 font-medium">Joined</th>
                      <th className="py-2 px-3 font-medium">Code</th>
                      <th className="py-2 px-3 font-medium text-right">Sign-ins</th>
                      <th className="py-2 px-3 font-medium">Last sign-in</th>
                      <th className="py-2 pl-3 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="border-b last:border-0 align-top">
                        <td className="py-2 pr-3">
                          <p className="font-medium">{p.display_name}</p>
                          <p className="text-xs text-muted-foreground">{p.email} · {ROLE[p.role] ?? p.role}</p>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{p.created_at ? format(new Date(p.created_at), "d MMM yyyy") : ""}</td>
                        <td className="py-2 px-3 text-muted-foreground">{p.via_code ?? ""}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{p.login_count}</td>
                        <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{ago(p.last_login_at)}</td>
                        <td className="py-2 pl-3 text-muted-foreground">
                          <span className="whitespace-nowrap">{ago(p.last_seen_at)}</span>
                          {p.last_page && <p className="text-[11px] font-mono truncate max-w-[14rem]" title={p.last_page}>{p.last_page}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="md:hidden divide-y rounded-lg border">
                {rows.map((p) => (
                  <li key={p.id} className="p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-medium text-sm truncate">{p.display_name}</p>
                      <p className="text-[11px] text-muted-foreground shrink-0">{ROLE[p.role] ?? p.role}</p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                    <div className="grid grid-cols-3 gap-1 mt-2 text-center">
                      <div className="rounded-md bg-muted/50 py-1.5">
                        <p className="text-sm font-semibold tabular-nums">{p.login_count}</p>
                        <p className="text-[10px] text-muted-foreground">Sign-ins</p>
                      </div>
                      <div className="rounded-md bg-muted/50 py-1.5 px-1">
                        <p className="text-xs font-medium truncate">{p.last_login_at ? formatDistanceToNow(new Date(p.last_login_at)) : "Never"}</p>
                        <p className="text-[10px] text-muted-foreground">Last sign-in</p>
                      </div>
                      <div className="rounded-md bg-muted/50 py-1.5 px-1">
                        <p className="text-xs font-medium truncate">{p.last_seen_at ? formatDistanceToNow(new Date(p.last_seen_at)) : "Never"}</p>
                        <p className="text-[10px] text-muted-foreground">Last seen</p>
                      </div>
                    </div>
                    {p.via_code && <p className="text-[11px] text-muted-foreground mt-1.5">Code: {p.via_code}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
