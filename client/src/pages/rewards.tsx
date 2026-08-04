/**
 * Token Wallet.
 *
 * This page REPLACED the old "My Rewards" page, which rendered `creator_rewards`
 * — a table with no writer anywhere in the codebase, so it could only ever show
 * a balance of 0. That table is now read-only and superseded by `token_ledger`.
 * There is deliberately ONE credit UI: if you are adding a second, stop.
 *
 * The route /creator/rewards still resolves here so old links and bookmarks land
 * on the real wallet instead of 404ing.
 *
 * Everything shown is derived from the append-only ledger — the balance is
 * SUM(deltaTokens), never a stored counter. Each row is valued at the price
 * captured when it was written, which is why a row shows `rowUsdCents` rather
 * than being recomputed against today's token price.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { StatCard } from "@/components/StatCard";
import { NOT_CASH_STATEMENT } from "@/components/TokenPayOption";
import {
  Wallet, Coins, ArrowDownLeft, ArrowUpRight, Lock, Library,
  ListVideo, CreditCard, Send, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { format } from "date-fns";
import {
  useWallet, tokenLabel, centsToMoney, usdWhole, reasonLabel,
  attributionLabel, TOKEN_USD, type WalletEntry,
} from "@/hooks/useWallet";
import { planPriceMajor } from "@shared/plans";
import { LICENSE_FEE } from "@shared/pricing";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/** $249 — the Brand tier whose first paid invoice mints a token. */
const QUALIFYING_PLAN_PRICE = planPriceMajor("starter");

const SPEND_TARGETS = [
  {
    icon: Library,
    label: "List a video in the Global Video Library",
    cost: `1 token (${usdWhole(LICENSE_FEE)})`,
    href: "/creator/my-videos",
    cta: "Go to My Campaigns",
  },
  {
    icon: ListVideo,
    label: "Publish a curated playlist",
    cost: `1 token per video (${usdWhole(LICENSE_FEE)} each)`,
    href: "/creator/playlists",
    cta: "Go to My Playlists",
  },
  {
    icon: CreditCard,
    label: "Reduce your monthly subscription fee",
    cost: `${usdWhole(TOKEN_USD)} of credit per token`,
    href: "/creator/settings/subscription",
    cta: "Go to Subscription",
  },
];

function LedgerRow({ entry }: { entry: WalletEntry }) {
  const isCredit = entry.deltaTokens > 0;
  const attribution = attributionLabel(entry.attributionMethod);

  return (
    <div
      className="flex items-center justify-between gap-4 rounded-xl border border-border p-4"
      data-testid={`wallet-entry-${entry.id}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
            isCredit ? "bg-primary/10" : "bg-muted"
          }`}
        >
          {isCredit
            ? <ArrowDownLeft className="h-4 w-4 text-primary" />
            : <ArrowUpRight className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{reasonLabel(entry.reason)}</p>
          {entry.description && (
            <p className="text-xs text-muted-foreground truncate">{entry.description}</p>
          )}
          {attribution && (
            <p className="text-xs text-muted-foreground truncate">{attribution}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {entry.createdAt ? format(new Date(entry.createdAt), "d MMM yyyy, HH:mm") : "—"}
          </p>
        </div>
      </div>

      <div className="text-right shrink-0">
        <p
          className={`text-base font-bold tabular-nums ${isCredit ? "text-primary" : "text-foreground"}`}
          data-testid={`wallet-entry-delta-${entry.id}`}
        >
          {isCredit ? "+" : "−"}{tokenLabel(Math.abs(entry.deltaTokens))}
        </p>
        {/* Historical value: what this row was worth the day it was written. */}
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {centsToMoney(entry.rowUsdCents)} of credit
        </p>
      </div>
    </div>
  );
}

export default function WalletPage() {
  const { data: user } = useCurrentUser();
  const { data: wallet, isLoading, isError } = useWallet();

  const balance = wallet?.balance ?? 0;
  const balanceUsdCents = wallet?.balanceUsdCents ?? 0;
  const entries = wallet?.entries ?? [];

  return (
    <div className="space-y-6 pb-24 md:pb-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Token Wallet</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              1 token = {usdWhole(TOKEN_USD)} of credit against Materialized fees
            </p>
          </div>
        </div>
      </div>

      {/* Compliance statement — deliberately at the top, not a footnote. */}
      <div
        className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4"
        data-testid="banner-not-cashable"
      >
        <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">Tokens are credit, not money</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{NOT_CASH_STATEMENT}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your affiliate commissions are separate and are paid out in cash — nothing on this page
            affects them.
          </p>
        </div>
      </div>

      {/* Totals */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            title="Token Balance"
            value={tokenLabel(balance)}
            subtitle={`${centsToMoney(balanceUsdCents)} of account credit`}
            icon={Coins}
          />
          <StatCard
            title="Lifetime Earned"
            value={tokenLabel(wallet?.lifetimeEarned ?? 0)}
            subtitle={`${centsToMoney(wallet?.lifetimeEarnedUsdCents ?? 0)} earned in total`}
            // Client's review: Earned reads up, Spent reads down. These were the
            // other way round (in/out arrows), which read as inverted to her.
            icon={ArrowUp}
          />
          <StatCard
            title="Lifetime Spent"
            value={tokenLabel(wallet?.lifetimeSpent ?? 0)}
            subtitle={`${centsToMoney(wallet?.lifetimeSpentUsdCents ?? 0)} used on fees`}
            icon={ArrowDown}
          />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            We couldn't load your wallet just now. Refresh the page to try again.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* How they're earned */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              How you earn tokens
            </CardTitle>
            <CardDescription>
              Introduce a brand to Materialized. When that brand pays for its first{" "}
              {usdWhole(QUALIFYING_PLAN_PRICE)}/month Brand subscription, you receive{" "}
              <strong className="text-foreground">1 token ({usdWhole(TOKEN_USD)} of credit)</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground leading-relaxed">
              A brand can be tagged by many creators, so only{" "}
              <strong className="text-foreground">one token is ever issued per brand</strong>, on its
              first paid subscription. It goes to the creator who referred the brand; if there was no
              referral, it goes to the creator who tagged it{" "}
              <strong className="text-foreground">first</strong>.
            </p>
            <p className="text-xs text-muted-foreground">
              Nothing is issued while a brand is on a free trial — the token is minted on the first
              real payment. Attribution can be corrected by Materialized if a brand disputes it.
            </p>
            <Separator />
            <Link href="/creator/referrals">
              <span className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline cursor-pointer" data-testid="link-brand-referrals">
                Refer a brand
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </CardContent>
        </Card>

        {/* What they're spent on */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              What you can spend them on
            </CardTitle>
            <CardDescription>
              Tokens are spent in whole units against Materialized's own fees.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {SPEND_TARGETS.map(({ icon: Icon, label, cost, href, cta }) => (
              <Link key={href} href={href}>
                <div
                  className="flex items-center gap-3 rounded-xl border border-border p-3 hover-elevate cursor-pointer"
                  data-testid={`link-spend-${href.split("/").pop()}`}
                  title={cta}
                >
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{label}</p>
                    <p className="text-xs text-muted-foreground">{cost}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Token history</CardTitle>
          <CardDescription>
            Every token earned and spent, oldest first. This record is append-only — entries are never
            edited or removed, and a correction appears as its own line.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
            </div>
          ) : !user ? (
            <div className="text-center py-12">
              <Wallet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Sign in to see your token history.</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <Coins className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-base font-semibold mb-1">No tokens yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Refer a brand, or be the first creator to tag one. When that brand pays for its first{" "}
                {usdWhole(QUALIFYING_PLAN_PRICE)}/month subscription, {usdWhole(TOKEN_USD)} of credit
                lands here.
              </p>
              <Link href="/creator/referrals">
                <span className="inline-flex items-center gap-1 mt-4 text-sm font-medium text-primary hover:underline cursor-pointer" data-testid="link-refer-brand-empty">
                  Refer a brand
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            </div>
          ) : (
            <div className="space-y-3" data-testid="wallet-ledger">
              {entries.map((entry) => <LedgerRow key={entry.id} entry={entry} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
