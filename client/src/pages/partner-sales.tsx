/**
 * Partner sales: every sale a partner earned on and how it split, and the
 * people they brought in with the date each one stops earning (client, 2 Nov
 * 2026; promised to Clipur). Data from GET /api/program/sales, which only
 * ever returns the signed-in partner's own rows (server/partnerSales.ts).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Receipt, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportToCsv } from "@/lib/exportCsv";
import { cn } from "@/lib/utils";

interface Sale {
  id: string; at: string; video: string; product: string | null; brand: string | null; creator: string | null;
  through: "brand" | "creator" | "both" | null;
  saleCents: number; brandCents: number; creatorCents: number; publisherCents: number; otherPartnersCents: number;
  youCents: number; youPct: number; mtrlzdCents: number; status: string;
}
interface Referral {
  userId: string; name: string; role: "brand" | "creator" | "publisher";
  joinedAt: string; countsFrom: string; earnsUntil: string; viaBrand: string | null; earning: boolean;
}
interface Report {
  deal: { pct: number | null; until: string | null; accountActive: boolean; referralDays: number };
  totals: { sales: number; saleCents: number; youCents: number; pendingCents: number; paidCents: number };
  sales: Sale[];
  referrals: Referral[];
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const dayTime = (s: string) => new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const ROLE: Record<Referral["role"], string> = { brand: "Brand", creator: "Creator", publisher: "Publisher" };
const THROUGH: Record<NonNullable<Sale["through"]>, string> = { brand: "Your brand", creator: "Your creator", both: "Your brand and creator" };
const STATUS: Record<string, string> = { pending: "Pending", approved: "Approved", paid: "Paid", reversed: "Refunded", rejected: "Rejected" };
const counted = (s: Sale) => s.status !== "reversed" && s.status !== "rejected";

export default function PartnerSales() {
  const { data, isLoading, error } = useQuery<Report>({ queryKey: ["/api/program/sales"] });
  const [tab, setTab] = useState("sales");

  if (isLoading) {
    return <div className="flex items-center gap-2 py-24 justify-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>;
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center space-y-3" data-testid="partner-sales-unavailable">
        <Receipt className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">Partner sales</h1>
        <p className="text-sm text-muted-foreground">This page is for MTRLZD partners. Ask the MTRLZD team to set up your partner account.</p>
      </div>
    );
  }

  const { deal, totals, sales, referrals } = data;
  const earningNow = referrals.filter((r) => r.earning).length;
  const anyOtherPartners = sales.some((s) => s.otherPartnersCents > 0);

  const handleExport = () =>
    exportToCsv("mtrlzd-partner-sales", sales, [
      { header: "Date (UTC)", value: (s) => s.at },
      { header: "Video", value: (s) => s.video },
      { header: "Product", value: (s) => s.product ?? "" },
      { header: "Brand", value: (s) => s.brand ?? "" },
      { header: "Creator", value: (s) => s.creator ?? "" },
      { header: "Credited through", value: (s) => (s.through ? THROUGH[s.through] : "") },
      { header: "Sale", value: (s) => (s.saleCents / 100).toFixed(2) },
      { header: "Brand share", value: (s) => (s.brandCents / 100).toFixed(2) },
      { header: "Creator share", value: (s) => (s.creatorCents / 100).toFixed(2) },
      { header: "Publisher share", value: (s) => (s.publisherCents / 100).toFixed(2) },
      ...(anyOtherPartners ? [{ header: "Other partners", value: (s: Sale) => (s.otherPartnersCents / 100).toFixed(2) }] : []),
      { header: "Your %", value: (s) => s.youPct },
      { header: "Your share", value: (s) => (s.youCents / 100).toFixed(2) },
      { header: "MTRLZD share", value: (s) => (s.mtrlzdCents / 100).toFixed(2) },
      { header: "Status", value: (s) => STATUS[s.status] ?? s.status },
    ]);

  return (
    <div className="space-y-6 pb-24 md:pb-8" data-testid="partner-sales">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Partner sales</h1>
        <p className="mt-1 text-muted-foreground">
          {deal.pct != null
            ? <>You earn {deal.pct}% of sales by the brands and creators you brought in, for {deal.referralDays} days from when each one joins{deal.until ? <>, until your deal ends on {day(new Date(new Date(deal.until).getTime() - 1).toISOString())}</> : null}. It comes out of MTRLZD's 15% fee, never the brand's share.</>
            : <>Every sale you earn on, and how it splits.</>}
        </p>
      </div>

      {(deal.pct == null || !deal.accountActive) && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="partner-deal-notice">
          {deal.pct == null
            ? "You don't have an active partner commission right now, so new sales won't earn you a share. Talk to the MTRLZD team to set one up."
            : "Your MTRLZD account isn't active, so new sales won't earn you a share until it is. Your referrals stay on MTRLZD either way."}
        </div>
      )}

      {/* Display-only numbers: side by side at every width, compact on a phone. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile label="Sales" value={String(totals.sales)} sub={money(totals.saleCents)} testid="tile-sales" />
        <Tile label="Earned" value={money(totals.youCents)} sub={`${money(totals.paidCents)} paid`} testid="tile-earned" />
        <Tile label="Referrals" value={String(referrals.length)} sub={`${earningNow} earning now`} testid="tile-referrals" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="sales" data-testid="tab-sales">Sales</TabsTrigger>
            <TabsTrigger value="referrals" data-testid="tab-referrals">Referrals</TabsTrigger>
          </TabsList>
          {tab === "sales" && sales.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExport} data-testid="button-export-sales">
              <Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Export CSV</span>
            </Button>
          )}
        </div>

        <TabsContent value="sales" className="mt-4">
          {sales.length === 0 ? (
            <Empty icon={Receipt} text="No sales yet. When a brand or creator you brought in makes a sale, it shows here with how it split." />
          ) : (
            <>
              {/* Phone: one card per sale. */}
              <div className="space-y-3 md:hidden">
                {sales.map((s) => (
                  <div key={s.id} className={cn("rounded-xl border bg-card p-4", !counted(s) && "opacity-60")} data-testid={`sale-card-${s.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{s.product ?? s.video}</p>
                        <p className="text-xs text-muted-foreground truncate">{[s.brand, s.creator].filter(Boolean).join(" · ")}</p>
                        <p className="text-xs text-muted-foreground">{dayTime(s.at)}</p>
                      </div>
                      <StatusBadge status={s.status} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
                      <dt className="text-muted-foreground">Sale</dt><dd className="text-right font-medium">{money(s.saleCents)}</dd>
                      <dt className="text-muted-foreground">Brand</dt><dd className="text-right">{money(s.brandCents)}</dd>
                      <dt className="text-muted-foreground">Creator</dt><dd className="text-right">{money(s.creatorCents)}</dd>
                      <dt className="text-muted-foreground">Publisher</dt><dd className="text-right">{money(s.publisherCents)}</dd>
                      {s.otherPartnersCents > 0 && <><dt className="text-muted-foreground">Other partners</dt><dd className="text-right">{money(s.otherPartnersCents)}</dd></>}
                      <dt className="font-semibold">You ({s.youPct}%)</dt><dd className="text-right font-semibold">{money(s.youCents)}</dd>
                      <dt className="text-muted-foreground">MTRLZD</dt><dd className="text-right">{money(s.mtrlzdCents)}</dd>
                    </dl>
                    {s.through && <p className="mt-2 text-xs text-muted-foreground">Credited through {THROUGH[s.through].toLowerCase()}</p>}
                  </div>
                ))}
              </div>

              {/* Desktop: the full split in one table. */}
              <div className="hidden md:block overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-sm" data-testid="sales-table">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Sale from</th>
                      <th className="px-4 py-3 font-medium text-right">Sale</th>
                      <th className="px-4 py-3 font-medium text-right">Brand</th>
                      <th className="px-4 py-3 font-medium text-right">Creator</th>
                      <th className="px-4 py-3 font-medium text-right">Publisher</th>
                      {anyOtherPartners && <th className="px-4 py-3 font-medium text-right">Other partners</th>}
                      <th className="px-4 py-3 font-medium text-right text-foreground">You</th>
                      <th className="px-4 py-3 font-medium text-right">MTRLZD</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id} className={cn("border-b last:border-0 align-top tabular-nums", !counted(s) && "opacity-60")} data-testid={`sale-row-${s.id}`}>
                        <td className="px-4 py-3 whitespace-nowrap">{dayTime(s.at)}</td>
                        <td className="px-4 py-3 min-w-[14rem]">
                          <p className="font-medium">{s.product ?? s.video}</p>
                          <p className="text-xs text-muted-foreground">{[s.brand, s.creator].filter(Boolean).join(" · ")}</p>
                          {s.through && <p className="text-xs text-muted-foreground">Through {THROUGH[s.through].toLowerCase()}</p>}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{money(s.saleCents)}</td>
                        <td className="px-4 py-3 text-right">{money(s.brandCents)}</td>
                        <td className="px-4 py-3 text-right">{money(s.creatorCents)}</td>
                        <td className="px-4 py-3 text-right">{money(s.publisherCents)}</td>
                        {anyOtherPartners && <td className="px-4 py-3 text-right">{money(s.otherPartnersCents)}</td>}
                        <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{money(s.youCents)} <span className="text-xs font-normal text-muted-foreground">{s.youPct}%</span></td>
                        <td className="px-4 py-3 text-right">{money(s.mtrlzdCents)}</td>
                        <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                The brand always keeps 85%. Creator, publisher and your share come out of MTRLZD's 15%, and Stripe's card fee is paid from MTRLZD's part. Refunded sales are shown faded and not counted.
              </p>
            </>
          )}
        </TabsContent>

        <TabsContent value="referrals" className="mt-4">
          {referrals.length === 0 ? (
            <Empty icon={Users} text="No one has joined on your codes yet. Brands and creators who sign up with your codes appear here, with the date each one stops earning you a share." />
          ) : (
            <div className="rounded-xl border bg-card divide-y" data-testid="referrals-list">
              {referrals.map((r) => (
                <div key={r.userId} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`referral-${r.userId}`}>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.name} <span className="text-xs font-normal text-muted-foreground">· {ROLE[r.role]}</span></p>
                    <p className="text-xs text-muted-foreground">
                      Joined {day(r.joinedAt)}{r.viaBrand ? <> on {r.viaBrand}'s invite, so counted from when {r.viaBrand} joined ({day(r.countsFrom)})</> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:text-right">
                    <span className="text-xs text-muted-foreground">{r.earning ? "Earning until" : "Ended"} {day(r.earnsUntil)}</span>
                    <Badge variant={r.earning ? "default" : "outline"} className="font-normal">{r.earning ? "Earning" : "Ended"}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Tile({ label, value, sub, testid }: { label: string; value: string; sub: string; testid: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 sm:p-4" data-testid={testid}>
      <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground truncate">{label}</p>
      <p className="mt-0.5 text-lg sm:text-2xl font-semibold tabular-nums leading-tight truncate">{value}</p>
      <p className="mt-0.5 text-[11px] sm:text-xs text-muted-foreground truncate">{sub}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "paid" ? "default" : "outline"} className="font-normal shrink-0">{STATUS[status] ?? status}</Badge>;
}

function Empty({ icon: Icon, text }: { icon: typeof Receipt; text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <Icon className="mx-auto h-7 w-7 text-muted-foreground" />
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
