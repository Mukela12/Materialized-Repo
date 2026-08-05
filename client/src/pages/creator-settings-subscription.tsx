import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PricingEstimator } from "@/components/PricingEstimator";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, CalendarDays, CheckCircle, Clock, Zap, TrendingUp, ExternalLink, CreditCard, AlertTriangle, Video, Badge as BadgeIcon, Coins, Minus, Plus, Loader2, Info } from "lucide-react";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BrandSubscription } from "@shared/schema";
import { CURRENCY_SYMBOL, PLATFORM_CURRENCY_CODE } from "@/lib/currency";
import { planPriceMajor, type PlanKey } from "@shared/plans";
import { TokenBalancePill, NotCashableNote } from "@/components/TokenPayOption";
import {
  useTokenBalance, walletPost, useInvalidateWallet, tokenLabel, usdWhole, TOKEN_USD,
} from "@/hooks/useWallet";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const price = (plan: PlanKey) => `${CURRENCY_SYMBOL}${planPriceMajor(plan)}`;

/**
 * Creators are offered the Creator tier. `starter` / `pro` stay in the array as
 * `legacy` rows purely so an EXISTING subscriber on one of those plans still sees
 * their real plan and price — `currentPlan` below falls back to PLANS[0] for any
 * id it can't find, which would otherwise show them the wrong tier. Legacy rows
 * are filtered out of the picker, so they can't be newly purchased here.
 */
const PLANS: {
  id: PlanKey;
  label: string;
  price: string;
  period: string;
  description: string;
  popular?: boolean;
  legacy?: boolean;
  features: string[];
}[] = [
  {
    id: "creator",
    label: "Creator",
    price: price("creator"),
    period: "/ month",
    description: "For creators monetising their videos",
    popular: true,
    features: [
      "Unlimited shoppable videos",
      "Unlimited data storage",
      "Unlimited campaigns",
      "Full affiliate payouts + surplus billing",
      "Advanced analytics & API access",
    ],
  },
  {
    id: "starter",
    label: "Brand",
    price: price("starter"),
    period: "/ month",
    legacy: true,
    description: "For brands running video commerce campaigns",
    features: [
      "Up to 10 shoppable videos",
      "30 minutes data storage",
      "5 active campaigns",
      "Affiliate payouts ledger",
      "Basic analytics",
    ],
  },
  {
    id: "pro",
    label: "Publisher",
    price: price("pro"),
    period: "/ month",
    legacy: true,
    description: "For publishers distributing at scale",
    features: [
      "Unlimited shoppable videos",
      "Unlimited data storage",
      "Unlimited campaigns",
      "Full affiliate payouts + surplus billing",
      "Advanced analytics & API access",
    ],
  },
];

/** Plans a creator can actually buy from this page. */
const OFFERED_PLANS = PLANS.filter((p) => !p.legacy);

// Rates come from shared/plans.ts so this page and every other surface quote
// the same price. They were duplicated here and in the brand settings page,
// and a third contradictory model lived on the brand dashboard.

/** Mirrors the server cap on POST /api/wallet/subsidise-subscription (`.max(50)`). */
const MAX_TOKENS_PER_APPLY = 50;

/**
 * One idempotency key per confirmed attempt. (spend_ref_type, spend_ref_id) is
 * UNIQUE server-side, so re-sending the SAME key returns the original result
 * instead of debiting twice — which is exactly what a double-click, a flaky
 * connection or an impatient retry produces.
 */
function newIdempotencyKey(): string {
  const rand = globalThis.crypto?.randomUUID?.();
  return rand ?? `sub-credit-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active:    { label: "Active",    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
    trialing:  { label: "Trial",     className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
    cancelled: { label: "Cancelled", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
    past_due:  { label: "Past Due",  className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  };
  const s = map[status] ?? map["active"];
  return <span data-testid="badge-subscription-status" className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface TrialStatus {
  hasActiveSubscription: boolean;
  videoCount: number;
  isTrialExhausted: boolean;
  trialVideosAllowed: number;
  trialMaxDurationSeconds: number;
  /**
   * Whether to OFFER the intro deal — presentation only. The checkout route
   * re-decides eligibility from the same rule server-side and is the real gate,
   * so a client that ignores this gets a 409, never a free trial.
   *
   * Optional because a cached/older server may not send it; absent reads as
   * "don't offer", which fails safe.
   */
  eligibleForIntroOffer?: boolean;
  introOfferSetupFee?: number;
  introOfferTrialDays?: number;
}

export default function CreatorSettingsSubscription() {
  const [location] = useLocation();
  const { toast } = useToast();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);

  // ── Token subsidy state ──
  const [tokensToApply, setTokensToApply] = useState(1);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const { data: currentUser } = useCurrentUser();
  const { balance: tokenBalance, isLoading: walletLoading } = useTokenBalance();
  const invalidateWallet = useInvalidateWallet();

  const { data: sub, isLoading: subLoading } = useQuery<BrandSubscription | null>({
    queryKey: ["/api/brand/subscription"],
  });

  const { data: trial, isLoading: trialLoading } = useQuery<TrialStatus>({
    queryKey: ["/api/users/me/trial-status"],
  });

  const checkoutMut = useMutation({
    mutationFn: async ({ plan, withTrial }: { plan: PlanKey; withTrial?: boolean }) => {
      const res = await apiRequest("POST", "/api/creator/subscription/checkout", { plan, withTrial });
      return res.json() as Promise<{ url: string; sessionId: string }>;
    },
    onSuccess: ({ url }) => { if (url) window.location.href = url; },
    onError: (err: any) =>
      toast({
        // The server refuses the intro offer to anyone who has subscribed before.
        // Say so plainly rather than showing a generic failure — the user has done
        // nothing wrong and the normal plans are still available to them.
        title: err?.code === "TRIAL_NOT_ELIGIBLE" ? "Introductory offer unavailable" : "Couldn't start checkout",
        description: err?.message,
        variant: "destructive",
      }),
  });

  const portalMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/creator/subscription/portal", {});
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => { if (url) window.location.href = url; },
    onError: (err: any) => toast({ title: "Couldn't open billing portal", description: err?.message, variant: "destructive" }),
  });


  // ── Token subsidy, derived ──
  // The wallet is the ceiling; the server also caps a single request at 50.
  const maxApplicable = Math.min(tokenBalance, MAX_TOKENS_PER_APPLY);
  // Clamp so a stale state value can never quote — or SPEND — more than is available.
  // `applying` is what the button says AND what gets sent; they must not diverge.
  const applying = maxApplicable < 1 ? 0 : Math.max(1, Math.min(tokensToApply, maxApplicable));
  const creditValue = applying * TOKEN_USD;
  const hasBillingAccount = !!currentUser?.stripeCustomerId;
  const subsidyBlockedReason = !hasBillingAccount
    ? "Tokens apply to a Stripe invoice, so you need an active subscription first. Start one below and your tokens will be waiting."
    : !walletLoading && tokenBalance < 1
      ? `You have no tokens yet. You earn 1 token (${usdWhole(TOKEN_USD)} of credit) when a brand you introduced pays for its first ${usdWhole(planPriceMajor("starter"))}/month subscription.`
      : null;

  /**
   * Spend tokens as a credit against the next invoice.
   *
   * The server debits the wallet FIRST and commits, then asks Stripe for a negative
   * customer balance transaction; if Stripe fails it appends a compensating refund
   * row. So a failure here never silently eats tokens — but it does mean the toast
   * must not promise a discount the API did not confirm.
   */
  const subsidyMut = useMutation({
    mutationFn: async () => {
      const { ok, data } = await walletPost("/api/wallet/subsidise-subscription", {
        tokens: applying,
        idempotencyKey,
      });
      if (!ok) {
        // The attempt is SPENT. Either Stripe failed and the server appended a
        // compensating refund (502, tokensRefunded), or a previous attempt on this
        // key was already refunded (409 spend_already_refunded). Either way the
        // wallet is whole and this key must never be sent again: re-sending it made
        // the server issue another refund against the same debit — a credit with no
        // debit behind it. The server now refuses that outright; rotating here is
        // what turns the refusal back into a retry the user can actually make.
        if (data.tokensRefunded !== undefined || data.code === "spend_already_refunded" || data.code === "idempotency_key_conflict") {
          setIdempotencyKey(newIdempotencyKey());
          invalidateWallet();
        }
        if (data.balance !== undefined && data.required !== undefined) {
          throw new Error(`You have ${tokenLabel(data.balance)} — ${tokenLabel(data.required)} requested.`);
        }
        throw new Error(data.error || "Couldn't apply your tokens");
      }
      return data as { tokensSpent: number; creditCents: number; alreadyApplied?: boolean };
    },
    onSuccess: (data) => {
      invalidateWallet();
      // A fresh key so the NEXT application is a new spend rather than a replay of this one.
      setIdempotencyKey(newIdempotencyKey());
      setTokensToApply(1);
      toast({
        title: data.alreadyApplied ? "Already applied" : "Credit applied",
        description: `${CURRENCY_SYMBOL}${(data.creditCents / 100).toFixed(2)} of credit is on your billing account and comes off your next invoice automatically.`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Couldn't apply tokens", description: err?.message, variant: "destructive" }),
  });


  // Falls back to the offered tier only when the stored plan is unknown.
  const currentPlan = PLANS.find(p => p.id === sub?.plan) ?? OFFERED_PLANS[0];
  const isSuccess   = location.includes("checkout=success");
  const isCancelled = location.includes("checkout=cancelled");
  const isOnTrial   = !trial?.hasActiveSubscription;

  return (
    <div className="space-y-6 max-w-2xl pb-12">
      <div className="flex items-center gap-3">
        {/* /creator/settings is not a route — this 404'd. The parent is
            /creator/more ("Profile & Settings"), which is where this page is
            linked from in the first place. */}
        <Link href="/creator/more">
          <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Creator Subscription</h1>
          <p className="text-muted-foreground text-sm">Your plan, billing, and usage overage</p>
        </div>
      </div>

      {isSuccess && (
        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-800 dark:text-green-300 text-sm">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Subscription activated — you can now upload unlimited videos!
        </div>
      )}
      {isCancelled && (
        <div className="flex items-center gap-3 p-4 bg-muted border border-border rounded-xl text-muted-foreground text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Checkout was cancelled. Your plan has not changed.
        </div>
      )}

      {/* Free trial banner */}
      {/*
        `trial &&` is load-bearing, not defensive noise. isOnTrial is
        `!trial?.hasActiveSubscription`, which is TRUE when the query failed and
        `trial` is undefined — so without this the banner renders on an error and
        every `trial.x` below throws. It also narrows the type for the whole block.
      */}
      {!trialLoading && trial && isOnTrial && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Video className="h-4 w-4 text-primary" />
            <p className="font-semibold text-sm text-foreground">Free Trial</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            You are on the <strong className="text-foreground">free trial</strong>. You can upload <strong className="text-foreground">1 shoppable video up to 2 minutes</strong> — fully functional with analytics, affiliate tracking, and payouts ledger. Subscribe to upload more and remove the duration limit.
          </p>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${trial.isTrialExhausted ? "bg-red-500" : "bg-green-500"}`} />
              <span className="text-muted-foreground">
                {trial.isTrialExhausted ? "Trial video used" : `${trial.videoCount} / ${trial.trialVideosAllowed} trial video`}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Max 2 minutes per video</span>
            </div>
          </div>

          {/*
            The introductory offer. Shown only to creators who have never
            subscribed — `eligibleForIntroOffer` is presentation only, and the
            checkout route re-decides from the same rule, so hiding this is a
            courtesy rather than the control.

            The amounts and the day count come from the server (shared/plans.ts)
            rather than being written here, so the page cannot advertise a price
            different from the one Stripe charges.

            The card wording is deliberate and not upsell padding: with an amount
            due, Stripe stores the card as the subscription's default payment
            method, and it is later charged for overage. Someone agreeing to a
            one-off fee should not discover that separately.
          */}
          {trial.eligibleForIntroOffer && (
            <div className="rounded-xl border border-primary/40 bg-background p-4 space-y-2">
              <p className="font-semibold text-sm text-foreground">
                Get started for ${trial.introOfferSetupFee}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                A one-off ${trial.introOfferSetupFee} setup fee, then{" "}
                <strong className="text-foreground">{trial.introOfferTrialDays} days free</strong> — unlimited
                videos with no duration limit. Your card is saved for usage charges and your
                first monthly payment is taken after {trial.introOfferTrialDays} days. Cancel any
                time before then and you pay nothing further.
              </p>
              <Button
                data-testid="button-intro-offer"
                size="sm"
                className="rounded-full w-full sm:w-auto"
                disabled={checkoutMut.isPending}
                onClick={() => checkoutMut.mutate({ plan: "creator", withTrial: true })}
              >
                {checkoutMut.isPending
                  ? "Redirecting…"
                  : `Start ${trial.introOfferTrialDays} days free — $${trial.introOfferSetupFee} today`}
              </Button>
            </div>
          )}

          <Button
            data-testid="button-upgrade-from-trial"
            size="sm"
            className="rounded-full gap-2 w-full sm:w-auto"
            onClick={() => setPlanDialogOpen(true)}
          >
            <Zap className="h-3.5 w-3.5" />
            Subscribe to unlock more
          </Button>
        </div>
      )}

      {/* Current plan card */}
      {subLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg">{currentPlan.label} Plan</CardTitle>
                <p className="text-2xl font-bold mt-1">
                  {isOnTrial ? (
                    <span className="text-primary">Free Trial</span>
                  ) : (
                    <>
                      {currentPlan.price}
                      <span className="text-sm font-normal text-muted-foreground ml-1">{currentPlan.period}</span>
                    </>
                  )}
                </p>
              </div>
              <StatusBadge status={isOnTrial ? "trialing" : (sub?.status ?? "active")} />
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {!isOnTrial && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" /> Subscribed
                  </p>
                  <p className="font-medium" data-testid="text-subscribed-at">
                    {sub?.subscribedAt ? format(new Date(sub.subscribedAt), "d MMM yyyy") : "—"}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Next Renewal
                  </p>
                  <p className="font-medium" data-testid="text-period-end">
                    {sub?.currentPeriodEnd ? format(new Date(sub.currentPeriodEnd), "d MMM yyyy") : "—"}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">Included in your plan</p>
              <ul className="space-y-1.5">
                {currentPlan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Surplus fee calculator */}
            {/*
              One shared estimator. This was an inline copy of the same sliders
              and arithmetic that lived on the brand page too, and a third,
              contradictory model on the brand dashboard quoted $800 where these
              quoted $5,000 for identical usage.

              Also no longer gated on !isOnTrial. Someone on a trial is exactly
              who needs to know what the plan will cost them.
            */}
            <PricingEstimator plan="creator" className="border-0 shadow-none bg-muted/30" />

            <div className="flex gap-2">
              <Button
                data-testid="button-upgrade-plan"
                className="rounded-full gap-2"
                onClick={() => setPlanDialogOpen(true)}
              >
                <Zap className="h-4 w-4" />
                {isOnTrial
                  ? "Start Subscription"
                  : (OFFERED_PLANS.some(p => p.id === sub?.plan) ? "Manage Plan" : "Upgrade Plan")}
              </Button>
              {!isOnTrial && (
                <Button
                  data-testid="button-billing-portal"
                  variant="outline"
                  className="rounded-full gap-2"
                  disabled={portalMut.isPending}
                  onClick={() => portalMut.mutate()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {portalMut.isPending ? "Opening…" : "Billing Portal"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Pay part of your bill with tokens ──
          Always rendered, never hidden: when it can't be used it says why, so a
          creator knows the option exists and what unlocks it. */}
      <Card data-testid="card-token-subsidy">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                Reduce your bill with tokens
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Each token takes {usdWhole(TOKEN_USD)} off what you pay Materialized.
              </p>
            </div>
            <TokenBalancePill />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Amount stepper */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tokens to apply</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  disabled={applying <= 1 || !!subsidyBlockedReason || subsidyMut.isPending}
                  onClick={() => setTokensToApply(Math.max(1, applying - 1))}
                  data-testid="button-token-decrement"
                  aria-label="Use one fewer token"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-10 text-center text-xl font-bold tabular-nums" data-testid="text-tokens-to-apply">
                  {applying}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  disabled={applying >= maxApplicable || !!subsidyBlockedReason || subsidyMut.isPending}
                  onClick={() => setTokensToApply(Math.min(maxApplicable, applying + 1))}
                  data-testid="button-token-increment"
                  aria-label="Use one more token"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-1">Credit applied</p>
              <p className="text-2xl font-bold tabular-nums text-primary" data-testid="text-subsidy-credit">
                {CURRENCY_SYMBOL}{creditValue}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {tokenBalance > 0
                  ? `${tokenLabel(applying)} of ${tokenLabel(tokenBalance)}`
                  : "No tokens in your wallet"}
              </p>
            </div>
          </div>

          <Button
            className="w-full rounded-full gap-2"
            disabled={!!subsidyBlockedReason || subsidyMut.isPending || walletLoading || maxApplicable < 1}
            onClick={() => subsidyMut.mutate()}
            data-testid="button-apply-tokens-to-subscription"
          >
            {subsidyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
            {subsidyMut.isPending
              ? "Applying…"
              : applying < 1
                ? "No tokens to apply"
                : `Apply ${tokenLabel(applying)} — ${CURRENCY_SYMBOL}${creditValue} off`}
          </Button>

          {subsidyBlockedReason && (
            <p
              className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
              data-testid="text-subsidy-blocked-reason"
            >
              <Info className="h-3.5 w-3.5 mt-[1px] shrink-0" />
              <span>{subsidyBlockedReason}</span>
            </p>
          )}

          <p className="text-xs text-muted-foreground leading-relaxed">
            The credit sits on your billing account and Stripe takes it off your next invoice
            automatically. Applying tokens does not change your plan, and it cannot be reversed into
            cash or refunded to a card.
          </p>

          <NotCashableNote />
        </CardContent>
      </Card>

      {/* Plan selector dialog */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>Choose your creator plan</DialogTitle>
            <DialogDescription>
              Includes all trial features plus unlimited videos, campaigns, and affiliate payouts. Cancel anytime.
            </DialogDescription>
          </DialogHeader>

          <div className={`grid gap-3 pt-2 ${OFFERED_PLANS.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {OFFERED_PLANS.map((plan) => {
              const isCurrent = !isOnTrial && sub?.plan === plan.id;
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border p-4 space-y-3 flex flex-col ${plan.popular ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  {plan.popular && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] px-2.5 py-0.5 border-0 rounded-full font-medium">
                      Popular
                    </span>
                  )}
                  <div>
                    <p className="font-bold text-base text-foreground">{plan.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>
                  </div>
                  <div>
                    <span className="text-2xl font-bold">{plan.price}</span>
                    <span className="text-xs text-muted-foreground ml-1">{plan.period}</span>
                  </div>
                  <ul className="space-y-1.5 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    data-testid={`button-select-plan-${plan.id}`}
                    size="sm"
                    variant={plan.popular ? "default" : "outline"}
                    disabled={isCurrent || checkoutMut.isPending}
                    onClick={() => { setPlanDialogOpen(false); checkoutMut.mutate({ plan: plan.id }); }}
                    className="w-full rounded-xl"
                  >
                    {isCurrent ? "Current plan" : checkoutMut.isPending ? "Redirecting…" : `Subscribe — ${plan.price}/mo`}
                  </Button>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground text-center pt-1">
            Secure checkout via Stripe · Cancel anytime · {PLATFORM_CURRENCY_CODE} pricing
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
