/**
 * Admin: everyone who claimed passes on the Paris Creator Week page (client,
 * 3 Nov 2026), and whether each pass has been used. A claim is not a sign-up:
 * the creator and their friend each appear as joined only once they sign up
 * with their pass. Fed by parisClaimsReport.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { RefreshCw, Search, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportToCsv } from "@/lib/exportCsv";
import { cn } from "@/lib/utils";

type PassState = "joined" | "open" | "expired";
interface Pass { code: string; state: PassState; joinedAt: string | null; userId: string | null; name: string | null; videos: number }
interface Claim {
  id: string; claimedAt: string; firstName: string; email: string; platform: string;
  creatorHandle: string; friendHandle: string; activateBy: string; creator: Pass; friend: Pass;
}
interface Report { totals: { claims: number; creatorsJoined: number; friendsJoined: number; videos: number }; claims: Claim[] }

const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok" };
const day = (iso: string) => format(new Date(iso), "d MMM");

function passLabel(p: Pass, activateBy: string) {
  if (p.state === "joined") return `Joined ${p.joinedAt ? day(p.joinedAt) : ""}`.trim();
  if (p.state === "expired") return "Expired, not used";
  return `Not yet, by ${day(activateBy)}`;
}

function PassBadge({ pass, activateBy, testid }: { pass: Pass; activateBy: string; testid?: string }) {
  return (
    <Badge
      variant={pass.state === "joined" ? "default" : "outline"}
      className={cn(
        "px-2 py-0 text-[11px] font-medium",
        pass.state === "joined" && "border-green-600/25 bg-green-500/10 text-green-700 dark:border-green-400/30 dark:text-green-400",
        pass.state === "expired" && "text-muted-foreground",
      )}
      data-testid={testid}
    >
      {passLabel(pass, activateBy)}
    </Badge>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border p-2.5 sm:p-3">
      <p className="truncate text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg sm:text-xl font-semibold tabular-nums leading-tight">{value}</p>
      {sub && <p className="truncate text-[10px] sm:text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function ParisClaims() {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "joined" | "waiting" | "expired">("all");
  const { data, isLoading, isError } = useQuery<Report>({ queryKey: ["/api/admin/paris-creator-week"] });
  const claims = data?.claims ?? [];
  const totals = data?.totals;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^@/, "");
    return claims.filter((c) => {
      if (show === "joined" && c.creator.state !== "joined" && c.friend.state !== "joined") return false;
      if (show === "waiting" && c.creator.state !== "open" && c.friend.state !== "open") return false;
      if (show === "expired" && c.creator.state !== "expired") return false;
      if (!needle) return true;
      return [c.firstName, c.email, c.creatorHandle, c.friendHandle].some((v) => v.toLowerCase().includes(needle));
    });
  }, [claims, q, show]);

  const exportRows = () => exportToCsv("paris-creator-week", rows, [
    { header: "Claimed", value: (c) => format(new Date(c.claimedAt), "yyyy-MM-dd HH:mm") },
    { header: "First name", value: (c) => c.firstName },
    { header: "Email", value: (c) => c.email },
    { header: "Platform", value: (c) => PLATFORM[c.platform] ?? c.platform },
    { header: "Handle", value: (c) => `@${c.creatorHandle}` },
    { header: "Their pass", value: (c) => c.creator.code },
    { header: "Their pass status", value: (c) => passLabel(c.creator, c.activateBy) },
    { header: "Their videos", value: (c) => String(c.creator.videos) },
    { header: "Friend's handle", value: (c) => `@${c.friendHandle}` },
    { header: "Friend's pass", value: (c) => c.friend.code },
    { header: "Friend's pass status", value: (c) => passLabel(c.friend, c.activateBy) },
    { header: "Friend's videos", value: (c) => String(c.friend.videos) },
    { header: "Activate by", value: (c) => format(new Date(c.activateBy), "yyyy-MM-dd") },
  ]);

  return (
    <Card data-testid="activity-paris-claims">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Users className="h-4 w-4" /> Paris Creator Week sign-ups</CardTitle>
        <CardDescription>
          Everyone who claimed passes on the Paris Creator Week page: a pass for them and one for a friend. A pass shows as
          joined once someone signs up with it. Passes must be used within 14 days of the claim, then give 30 days free.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : isError ? (
          <p className="text-sm text-destructive">Couldn't load the list. Try again in a moment.</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2" data-testid="paris-totals">
              <Stat label="Claims" value={totals?.claims ?? 0} />
              <Stat label="Joined" value={totals?.creatorsJoined ?? 0} sub="creators" />
              <Stat label="Friends" value={totals?.friendsJoined ?? 0} sub="joined" />
              <Stat label="Videos" value={totals?.videos ?? 0} sub="posted" />
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-0 flex-1 basis-56">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or handle" className="h-9 pl-9" data-testid="paris-search" />
              </div>
              <Select value={show} onValueChange={(v) => setShow(v as typeof show)}>
                <SelectTrigger className="h-9 w-40" data-testid="paris-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="joined">Joined</SelectItem>
                  <SelectItem value="waiting">Not joined yet</SelectItem>
                  <SelectItem value="expired">Passes expired</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-9" onClick={exportRows} disabled={rows.length === 0} data-testid="paris-export">Export CSV</Button>
            </div>

            {claims.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="paris-empty">
                No one has claimed passes yet. Claims from the Paris Creator Week page appear here straight away.
              </p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one matches that search.</p>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm" data-testid="paris-table">
                    <thead>
                      <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Claimed</th>
                        <th className="px-3 py-2 font-medium">Creator</th>
                        <th className="px-3 py-2 font-medium">Their pass</th>
                        <th className="px-3 py-2 font-medium">Friend</th>
                        <th className="px-3 py-2 font-medium">Friend's pass</th>
                        <th className="px-3 py-2 font-medium text-right">Videos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.id} className="border-b last:border-0 align-top" data-testid={`paris-row-${c.id}`}>
                          <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{day(c.claimedAt)}</td>
                          <td className="px-3 py-2.5 min-w-0">
                            <p className="font-medium">{c.firstName}</p>
                            <p className="text-xs text-muted-foreground break-all">{c.email}</p>
                            <p className="text-xs text-muted-foreground">@{c.creatorHandle} · {PLATFORM[c.platform] ?? c.platform}</p>
                          </td>
                          <td className="px-3 py-2.5"><PassBadge pass={c.creator} activateBy={c.activateBy} /></td>
                          <td className="px-3 py-2.5">
                            <p className="font-medium">@{c.friendHandle}</p>
                            {c.friend.name && <p className="text-xs text-muted-foreground">{c.friend.name}</p>}
                          </td>
                          <td className="px-3 py-2.5"><PassBadge pass={c.friend} activateBy={c.activateBy} /></td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{c.creator.videos + c.friend.videos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="md:hidden divide-y rounded-lg border" data-testid="paris-list">
                  {rows.map((c) => (
                    <li key={c.id} className="space-y-2 p-3" data-testid={`paris-card-${c.id}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium">{c.firstName} <span className="font-normal text-muted-foreground">@{c.creatorHandle}</span></p>
                        <p className="shrink-0 text-[11px] text-muted-foreground">{day(c.claimedAt)}</p>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{c.email} · {PLATFORM[c.platform] ?? c.platform}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="min-w-0 rounded-md bg-muted/50 p-2">
                          <p className="text-[10px] text-muted-foreground">Their pass</p>
                          <PassBadge pass={c.creator} activateBy={c.activateBy} />
                        </div>
                        <div className="min-w-0 rounded-md bg-muted/50 p-2">
                          <p className="truncate text-[10px] text-muted-foreground">Friend @{c.friendHandle}</p>
                          <PassBadge pass={c.friend} activateBy={c.activateBy} />
                        </div>
                      </div>
                      {c.creator.videos + c.friend.videos > 0 && (
                        <p className="text-[11px] text-muted-foreground">{c.creator.videos + c.friend.videos} video{c.creator.videos + c.friend.videos === 1 ? "" : "s"} posted</p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
