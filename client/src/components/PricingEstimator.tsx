/**
 * The pricing slider.
 *
 * ONE component, used everywhere a price is estimated. There were previously two
 * byte-identical copies inline in the creator and brand subscription pages, plus
 * a third contradictory model on the brand dashboard that quoted $800 where the
 * others quoted $5,000 for the same usage. `estimateBill` in shared/plans.ts is
 * now the only arithmetic; nothing here recomputes it.
 *
 * It renders the WHOLE bill, not just the overage. "Your overage is $0" is not
 * the question anyone is asking — they want to know what the month costs, and a
 * slider that only shows the extra makes the subscription invisible until the
 * moment it appears on a card statement.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  PLAN_ALLOWANCES, OVERAGE_RATES, estimateBill, planPriceMajor,
  PLAN_CONFIG, type PlanKey,
} from "@shared/plans";

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PricingEstimator({
  plan,
  selectablePlans,
  className,
  title = "Estimate your monthly bill",
}: {
  /** The tier to price. On a settings page this is the tier they are on. */
  plan: PlanKey;
  /**
   * Render a tier switcher. Used on the landing page, where the visitor has not
   * chosen a plan yet and the whole point is comparing them.
   */
  selectablePlans?: PlanKey[];
  className?: string;
  title?: string;
}) {
  const [active, setActive] = useState<PlanKey>(plan);
  const current = selectablePlans ? active : plan;
  const allowance = PLAN_ALLOWANCES[current];

  // Start AT the allowance, so the first thing anyone sees is the honest
  // headline: included usage costs exactly the plan price and nothing more.
  const [views, setViews] = useState(allowance.views);
  const [minutes, setMinutes] = useState(allowance.minutes);

  const bill = estimateBill(current, views, minutes);
  const isOver = bill.overageViews > 0 || bill.overageMinutes > 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {PLAN_CONFIG[current].name} includes{" "}
          <strong>{allowance.views.toLocaleString()} views</strong> and{" "}
          <strong>{allowance.minutes} minutes</strong> of uploaded video a month.
          Move the sliders to see what more would cost.
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {selectablePlans && (
          <div className="flex gap-2 flex-wrap">
            {selectablePlans.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setActive(p);
                  // Reset to the new tier's allowance, so the headline stays
                  // "included usage costs exactly the plan price".
                  setViews(PLAN_ALLOWANCES[p].views);
                  setMinutes(PLAN_ALLOWANCES[p].minutes);
                }}
                data-testid={`estimator-plan-${p}`}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  current === p
                    ? "bg-primary text-primary-foreground"
                    : "border border-border hover:bg-muted"
                }`}
              >
                {PLAN_CONFIG[p].name.replace("Materialized ", "").replace(" Plan", "")}
                {" · "}${planPriceMajor(p)}
              </button>
            ))}
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label className="text-sm font-medium">Views a month</label>
            <span className="text-sm tabular-nums" data-testid="text-views-value">
              {views.toLocaleString()}
              {bill.overageViews > 0 && (
                <span className="text-muted-foreground">
                  {" "}(+{bill.overageViews.toLocaleString()} over)
                </span>
              )}
            </span>
          </div>
          <Slider
            value={[views]} min={0} max={200_000} step={1_000}
            onValueChange={([v]) => setViews(v)}
            data-testid="slider-views"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {money(OVERAGE_RATES.perView)} per view beyond {allowance.views.toLocaleString()}
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label className="text-sm font-medium">Minutes uploaded</label>
            <span className="text-sm tabular-nums" data-testid="text-minutes-value">
              {minutes}
              {bill.overageMinutes > 0 && (
                <span className="text-muted-foreground"> (+{bill.overageMinutes} over)</span>
              )}
            </span>
          </div>
          <Slider
            value={[minutes]} min={0} max={300} step={2}
            onValueChange={([v]) => setMinutes(v)}
            data-testid="slider-minutes"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {money(OVERAGE_RATES.perMinute)} per minute beyond {allowance.minutes} — uploaded, not watched
          </p>
        </div>

        <div className="rounded-xl border border-border p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{PLAN_CONFIG[current].name}</span>
            <span className="tabular-nums">{money(bill.planPrice)}</span>
          </div>

          {bill.overageViews > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {bill.overageViews.toLocaleString()} extra views
              </span>
              <span className="tabular-nums" data-testid="text-view-cost">{money(bill.viewCost)}</span>
            </div>
          )}

          {bill.overageMinutes > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {bill.overageMinutes} extra minutes
              </span>
              <span className="tabular-nums" data-testid="text-minute-cost">{money(bill.minuteCost)}</span>
            </div>
          )}

          <div className="flex justify-between items-baseline pt-2 border-t border-border">
            <span className="font-semibold">Monthly total</span>
            <span className="text-xl font-bold tabular-nums" data-testid="text-bill-total">
              {money(bill.total)}
            </span>
          </div>

          {!isOver && (
            <Badge variant="secondary" className="mt-1">Within your plan — nothing extra</Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Estimate only. Usage is not billed automatically yet — this shows what a month
          would cost at the usage you have chosen.
        </p>
      </CardContent>
    </Card>
  );
}
