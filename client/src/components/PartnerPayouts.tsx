/**
 * Partner payouts on a partner's own homepage (client, 22 Nov 2026: partners
 * stay Brand accounts, "the exception that will need to be added to their
 * dashboard is Partner Payouts (2%)"). Renders nothing for an account with no
 * partner deal. The full list is the Partner sales page; the numbers are the
 * same ones (GET /api/program/sales).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProgram, partnerSalesPath } from "@/hooks/useProgram";
import { DotPill } from "@/components/RolePill";

interface Report {
  deal: { pct: number | null; accountActive: boolean; referralDays: number };
  totals: { sales: number; saleCents: number; youCents: number; pendingCents: number; paidCents: number; nextPayableAt: string | null };
  referrals: { earning: boolean }[];
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function Tile({ label, value, sub, testId }: { label: string; value: string; sub: string; testId: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-background p-2.5 sm:p-4" data-testid={testId}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-xs">{label}</p>
      <p className="mt-0.5 truncate text-base font-semibold leading-tight tabular-nums sm:text-2xl">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground sm:text-xs">{sub}</p>
    </div>
  );
}

export function PartnerPayouts({ role }: { role: string | undefined }) {
  const { data: program } = useProgram();
  const isPartner = !!program?.partner;
  const { data, isLoading } = useQuery<Report>({ queryKey: ["/api/program/sales"], enabled: isPartner });
  if (!isPartner) return null;

  const t = data?.totals;
  const pct = data?.deal.pct ?? program?.partnerPct ?? null;
  const brought = data?.referrals.length ?? 0;
  const paused = !!data && pct != null && !data.deal.accountActive;

  return (
    <section aria-labelledby="partner-payouts-heading" data-testid="section-partner-payouts">
      <Card>
        <CardContent className="space-y-3 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id="partner-payouts-heading" className="text-base font-semibold tracking-tight">Partner payouts</h2>
              <DotPill label={pct != null ? `Partner, ${pct}%` : "Partner"} dot="text-violet-500" testId="badge-partner-rate" />
            </div>
            <Link href={partnerSalesPath(role)} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" data-testid="link-partner-sales">
              Partner sales
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            {pct != null
              ? <>You earn {pct}% of the sales of the brands and creators you brought in, for {data?.deal.referralDays ?? 90} days from when each one joins. It is paid from MTRLZD's fee.</>
              : <>Your partner commission is not set up yet. Talk to the MTRLZD team.</>}
          </p>
          {paused && (
            <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="partner-paused-notice">
              Your partner status is paused after 60 days with no activity. Talk to the MTRLZD team to restart it.
            </p>
          )}
          {isLoading || !t ? (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[74px] rounded-xl sm:h-[98px]" />)}
            </div>
          ) : (
            /* Display-only numbers: side by side at every width, compact on a phone. */
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <Tile label="Earned" value={money(t.youCents)} sub={`${t.sales} ${t.sales === 1 ? "sale" : "sales"}`} testId="partner-tile-earned" />
              <Tile label="On the way" value={money(t.pendingCents)} sub={t.nextPayableAt ? `From ${day(t.nextPayableAt)}` : "Nothing held"} testId="partner-tile-pending" />
              <Tile label="Paid" value={money(t.paidCents)} sub={`${brought} ${brought === 1 ? "account" : "accounts"} joined`} testId="partner-tile-paid" />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
