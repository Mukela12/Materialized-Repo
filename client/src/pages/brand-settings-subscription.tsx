import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PricingEstimator } from "@/components/PricingEstimator";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CURRENCY_SYMBOL, PLATFORM_CURRENCY_CODE } from "@/lib/currency";
import { planPriceMajor, type PlanKey } from "@shared/plans";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft, CalendarDays, CheckCircle, Clock, Zap, TrendingUp,
  ExternalLink, CreditCard, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BrandSubscription } from "@shared/schema";

// ─── Plan catalogue ───────────────────────────────────────────────────────────
// Plan ids are the stable Stripe/DB keys (see shared/plans.ts) — `label` carries
// the customer-facing naming, so relabelling never touches billing.
// `legacy: true` keeps a plan renderable for an existing subscriber while hiding
// it from the picker.
const price = (plan: PlanKey) => `${CURRENCY_SYMBOL}${planPriceMajor(plan)}`;

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
    id: "starter",
    label: "Brand",
    price: price("starter"),
    period: "/ month",
    description: "For brands getting started with video commerce",
    features: [
      "Up to 10 videos",
      "30 minutes data storage",
      "5 active campaigns",
      "Basic analytics",
      "Email support",
    ],
  },
  {
    id: "pro",
    label: "Publisher",
    price: price("pro"),
    period: "/ month",
    description: "For scaling brands with unlimited reach",
    popular: true,
    features: [
      "Unlimited videos",
      "Unlimited data storage",
      "Unlimited campaigns",
      "Advanced analytics & API access",
      "Priority support",
    ],
  },
  {
    // Not offered here — present only so a user already on the Creator tier
    // renders their real plan and price instead of falling back to PLANS[0].
    id: "creator",
    label: "Creator",
    price: price("creator"),
    period: "/ month",
    legacy: true,
    description: "For creators monetising their videos",
    features: [
      "Unlimited shoppable videos",
      "Unlimited data storage",
      "Unlimited campaigns",
      "Full affiliate payouts + surplus billing",
      "Advanced analytics & API access",
    ],
  },
];

/** Plans a brand can actually buy from this page. */
const OFFERED_PLANS = PLANS.filter((p) => !p.legacy);

// Surplus pricing constants
// Rates come from shared/plans.ts so this page and every other surface quote
// the same price. They were duplicated here and in the brand settings page,
// and a third contradictory model lived on the brand dashboard.

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active:    { label: "Active",    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
    trialing:  { label: "Trial",     className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
    cancelled: { label: "Cancelled", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
    past_due:  { label: "Past Due",  className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  };
  const s = map[status] ?? map["active"];
  return (
    <span data-testid="badge-subscription-status" className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BrandSettingsSubscription() {
  const [location] = useLocation();
  const { toast } = useToast();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);

  const { data: sub, isLoading } = useQuery<BrandSubscription | null>({
    queryKey: ["/api/brand/subscription"],
  });

  const checkoutMut = useMutation({
    mutationFn: async (plan: PlanKey) => {
      const res = await apiRequest("POST", "/api/brand/subscription/checkout", { plan });
      return res.json() as Promise<{ url: string; sessionId: string }>;
    },
    onSuccess: ({ url }) => {
      if (url) window.location.href = url;
    },
    onError: (err: any) => {
      toast({ title: "Couldn't start checkout", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const portalMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/brand/subscription/portal", {});
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      if (url) window.location.href = url;
    },
    onError: (err: any) => {
      toast({ title: "Couldn't open billing portal", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });



  // Falls back to the entry-level offered tier only when the stored plan is unknown.
  const currentPlan = PLANS.find(p => p.id === sub?.plan) ?? OFFERED_PLANS[0];

  const isSuccess   = location.includes("checkout=success");
  const isCancelled = location.includes("checkout=cancelled");

  return (
    <div className="space-y-6 max-w-2xl pb-12">
      {/* Back header */}
      <div className="flex items-center gap-3">
        <Link href="/brand/settings">
          <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Subscription</h1>
          <p className="text-muted-foreground text-sm">Your current plan and billing</p>
        </div>
      </div>

      {/* Checkout return banners */}
      {isSuccess && (
        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-800 dark:text-green-300 text-sm">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Subscription activated — welcome aboard!
        </div>
      )}
      {isCancelled && (
        <div className="flex items-center gap-3 p-4 bg-muted border border-border rounded-xl text-muted-foreground text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Checkout was cancelled. Your plan has not changed.
        </div>
      )}

      {/* Current plan card */}
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg">{currentPlan.label} Plan</CardTitle>
                <p className="text-2xl font-bold mt-1">
                  {currentPlan.price}
                  <span className="text-sm font-normal text-muted-foreground ml-1">{currentPlan.period}</span>
                </p>
              </div>
              <StatusBadge status={sub?.status ?? "active"} />
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Dates */}
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

            {/* Features */}
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
            {/* Shared estimator — see the note on the creator page. */}
            <PricingEstimator plan={(currentPlan as any) || "starter"} className="border-0 shadow-none bg-muted/30" />

            {/* Plan action buttons */}
            <div className="flex gap-2">
              <Button
                data-testid="button-upgrade-plan"
                className="rounded-full gap-2"
                onClick={() => setPlanDialogOpen(true)}
              >
                <Zap className="h-4 w-4" />
                {sub?.plan === "pro" ? "Manage Plan" : "Upgrade Plan"}
              </Button>
              <Button
                data-testid="button-cancel-plan"
                variant="outline"
                className="rounded-full gap-2"
                disabled={portalMut.isPending}
                onClick={() => portalMut.mutate()}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {portalMut.isPending ? "Opening…" : "Billing Portal"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan selector dialog */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>Choose your plan</DialogTitle>
            <DialogDescription>
              You will be taken to Stripe to complete payment securely. Cancel anytime from the billing portal.
            </DialogDescription>
          </DialogHeader>

          <div className={`grid gap-3 pt-2 ${OFFERED_PLANS.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {OFFERED_PLANS.map((plan) => {
              const isCurrent = sub?.plan === plan.id;
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border p-4 space-y-3 flex flex-col ${
                    plan.popular
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  }`}
                >
                  {plan.popular && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] px-2.5 py-0.5 border-0 rounded-full">
                      Popular
                    </Badge>
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
                    onClick={() => { setPlanDialogOpen(false); checkoutMut.mutate(plan.id); }}
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
