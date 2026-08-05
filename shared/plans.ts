/**
 * Subscription plan catalogue — the single source of truth for both server and client.
 *
 * The KEYS ('creator' | 'starter' | 'pro') are stable identifiers. They are written
 * into live Stripe product/price metadata (`metadata.plan`) and persisted in
 * `brand_subscriptions.plan`, so they must NEVER be renamed:
 *
 *   - Renaming would require a live-mode metadata migration across every existing
 *     Stripe product and price. Any object missed makes `planFromSubscription()`
 *     (server/webhookHandlers.ts) fall through to its amount fallback — a silent
 *     tier change with correct billing but the wrong tier in the app.
 *   - Checkout sessions stamp `session.metadata.plan` at creation and read it back
 *     on webhook. A session started before a rename and completed after it would
 *     carry the old string.
 *
 * Human-facing names are decoupled: `label` in the client PLANS arrays, and `name`
 * below (which only ever applies to NEWLY created Stripe products — renaming it does
 * not rename an existing product; that needs an explicit stripe.products.update).
 *
 *   creator → $149/mo  labelled "Creator"
 *   starter → $249/mo  labelled "Brand"
 *   pro     → $499/mo  labelled "Publisher"
 */
export const PLAN_CONFIG = {
  creator: { name: 'Materialized Creator Plan', amount: 14900 },
  starter: { name: 'Materialized Starter Plan', amount: 24900 },
  pro:     { name: 'Materialized Pro Plan',     amount: 49900 },
} as const;

export type PlanKey = keyof typeof PLAN_CONFIG;

export const PLAN_KEYS = Object.keys(PLAN_CONFIG) as PlanKey[];

/** Runtime guard — use instead of casting untrusted strings to PlanKey. */
export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLAN_CONFIG, value);
}

/**
 * Which plans each checkout endpoint may sell.
 *
 * `plan` gates nothing server-side (entitlement keys off subscription STATUS, not
 * tier), so the endpoint allowlist is the only thing stopping a brand from buying
 * the cheaper Creator tier and receiving the full Brand/Publisher feature set.
 * Validate against these, not against the whole catalogue.
 *
 * CREATOR_PLANS stays permissive on purpose: creators who subscribed before the
 * Creator tier existed hold 'starter'/'pro' and must still be able to transact.
 */
export const BRAND_PLANS: readonly PlanKey[] = ['starter', 'pro'];
export const CREATOR_PLANS: readonly PlanKey[] = ['creator', 'starter', 'pro'];

/**
 * Which subscription tiers mint a wallet token for the creator who introduced the
 * subscriber. See server/wallet.ts.
 *
 * The client's words are: "reward Creators for tagging a Brand who completes a
 * $249 monthly subscription" — that is 'starter' and only 'starter'.
 *
 *   - 'creator' ($149) is EXCLUDED: it is the tier a creator buys for themselves.
 *     Minting against it funds a $49 reward out of a $149 subscription, and (with
 *     CREATOR_PLANS being deliberately permissive) is the self-mint a creator
 *     could arrange by tagging their own brand.
 *   - 'pro' ($499, Publisher) is EXCLUDED: a publisher is a different counterparty
 *     than the "Brand" the client described. This is the only arguable inclusion;
 *     it is left out because adding a tier later is additive and reversible, while
 *     clawing back already-minted tokens is neither.
 *
 * Adding a plan here is a ONE-LINE, reviewable business decision — which is the
 * whole point of it being a constant rather than an inline literal.
 */
export const TOKEN_QUALIFYING_PLANS: readonly PlanKey[] = ['starter'];

/** True iff `value` is a plan the given endpoint is allowed to sell. */
export function isAllowedPlan(value: unknown, allowed: readonly PlanKey[]): value is PlanKey {
  return isPlanKey(value) && allowed.includes(value);
}

/** Monthly price in MAJOR units (e.g. 149) for display. */
export function planPriceMajor(plan: PlanKey): number {
  return PLAN_CONFIG[plan].amount / 100;
}

/**
 * The onboarding offer: a one-off setup fee, then 30 days before the first
 * monthly charge.
 *
 * Both numbers live here, in MINOR units, for the same reason the plan amounts
 * do — the client renders exactly what the server charges. `amount` is passed to
 * Stripe verbatim; it is NOT the major-unit convention `createPaymentIntent`
 * uses, which multiplies by 100.
 *
 * WHY STRIPE OWNS THE CLOCK
 *   The 30 days are Stripe's `trial_period_days`, not a timestamp this app
 *   stores and sweeps. There is no scheduler in this codebase, so anything we
 *   dated ourselves would need one; Stripe already bills the first invoice on
 *   day 31 and emits the webhooks that keep the local row in step.
 *
 * WHY THE FEE MATTERS BEYOND THE REVENUE
 *   Because there is an amount due at checkout, Stripe collects and vaults a
 *   card and makes it the subscription's default payment method. That is the
 *   only route in this codebase to a card on file — there is no SetupIntent
 *   flow and no client-side Stripe.js — and it is what any later overage
 *   invoice has to charge against. A zero-fee variant therefore has to ask for
 *   the card explicitly; see createTrialWithSetupFeeCheckout.
 */
export const SETUP_FEE = { name: 'Materialized Setup Fee', amount: 2900 } as const;

/** Days before the first monthly charge. Stripe counts these, not us. */
export const TRIAL_DAYS = 30;

/** Setup fee in MAJOR units (e.g. 29) for display. */
export function setupFeeMajor(): number {
  return SETUP_FEE.amount / 100;
}

/**
 * WHAT EACH PLAN INCLUDES, and what usage beyond it costs.
 *
 * Confirmed by the client on 5 Aug 2026.
 *
 * ── The rate changed, deliberately ───────────────────────────────────────────
 * `perView` was $0.05. At that rate a creator on the $149 plan whose video did
 * 100,000 views — the outcome the whole product exists to produce — received a
 * bill of $4,649, thirty-one times their subscription. Delivering those views
 * costs on the order of $230, so it was priced like a per-conversion fee rather
 * than a per-view one, on the metric we encourage people to chase.
 *
 * $0.005 still recovers roughly twice cost and turns that same month into $599.
 * The point is not generosity; it is that a bill nobody can anticipate is a bill
 * that gets disputed rather than paid.
 *
 * ── Minutes are UPLOADED, not watched ────────────────────────────────────────
 * The client's call, and the simpler one: uploaded minutes are a number we
 * already hold on the video row. Watch-minutes are not recorded anywhere, and
 * an allowance in uploaded minutes charged against watched minutes is a unit
 * mismatch that produces a plausible, wrong bill.
 *
 * ── No publisher multiplier ──────────────────────────────────────────────────
 * The previous model multiplied both rates by the number of publishers
 * distributing a video, so one creator's allowance was consumed ten times over
 * by ten reposts. The client settled it: "Publisher is responsible for their own
 * overage, just like the other user types." Each account has its own allowance
 * and pays for its own usage. That is why `estimateBill` takes no publisher
 * count — it was removed rather than defaulted, so nobody can pass one and
 * quietly get the old behaviour.
 *
 * ── Still not authoritative ──────────────────────────────────────────────────
 * Nothing BILLS from these. They drive an on-screen estimate. Views are recorded
 * and deduplicated (analytics_events.viewer_hash) but never counted for money;
 * uploaded minutes are never summed. When usage billing is built these move to
 * platform_settings and the amount is computed server-side from recorded usage,
 * at which point this constant is the seed value, not the source of truth.
 */
export const OVERAGE_RATES = {
  /** Per view beyond the plan's allowance, in MAJOR units. */
  perView: 0.005,
  /** Per uploaded minute beyond the plan's allowance, in MAJOR units. */
  perMinute: 0.15,
} as const;

export interface PlanAllowance {
  /** Views included per month before per-view charges begin. */
  views: number;
  /** Videos included per month. Advisory — the bill is driven by minutes. */
  videos: number;
  /** Uploaded minutes included per month. */
  minutes: number;
}

/**
 * Keyed by the SAME plan keys as PLAN_CONFIG, so a tier cannot exist without an
 * allowance or vice versa.
 *
 * The client gave videos and minutes for creators (8 videos over 2 minutes, or
 * 16 minutes) and videos for the others; the minute figures for brand and
 * publisher follow their own arithmetic — 30 × 2 and 20 × 2.
 */
export const PLAN_ALLOWANCES: Record<PlanKey, PlanAllowance> = {
  creator: { views: 10_000, videos: 8, minutes: 16 },
  starter: { views: 10_000, videos: 30, minutes: 60 },
  pro:     { views: 10_000, videos: 20, minutes: 40 },
};

export interface BillEstimate {
  /** The monthly subscription, in MAJOR units. */
  planPrice: number;
  /** Views beyond the allowance, and what they cost. */
  overageViews: number;
  viewCost: number;
  /** Uploaded minutes beyond the allowance, and what they cost. */
  overageMinutes: number;
  minuteCost: number;
  /** planPrice + viewCost + minuteCost. */
  total: number;
}

/**
 * What a month costs at this usage.
 *
 * Usage AT the allowance costs nothing extra — the subtraction floors at zero,
 * so a creator using exactly their 10,000 views pays exactly their $149. Getting
 * that wrong in the other direction would charge from view one and make the
 * subscription price decorative.
 */
export function estimateBill(plan: PlanKey, views: number, minutes: number): BillEstimate {
  const allowance = PLAN_ALLOWANCES[plan];
  const planPrice = planPriceMajor(plan);

  const overageViews = Math.max(0, Math.round(views) - allowance.views);
  const overageMinutes = Math.max(0, Math.round(minutes) - allowance.minutes);

  const viewCost = overageViews * OVERAGE_RATES.perView;
  const minuteCost = overageMinutes * OVERAGE_RATES.perMinute;

  return {
    planPrice,
    overageViews,
    viewCost,
    overageMinutes,
    minuteCost,
    // Rounded to the cent: a bill is money, and floating point will otherwise
    // show $648.9999999999999 on a perfectly ordinary input.
    total: Math.round((planPrice + viewCost + minuteCost) * 100) / 100,
  };
}

/**
 * Who may take the introductory offer: first-time subscribers, and nobody else.
 *
 * Pass the caller's existing brand_subscriptions row, or null/undefined if they
 * have none. ANY row disqualifies — including `cancelled` and `past_due`.
 *
 * That is the whole point, and it is the opposite of what the code wants to be
 * refactored into. `prior?.status === 'active'` reads more natural and is wrong:
 * it would let a creator cancel, re-run checkout, and hold the product for the
 * setup fee every 30 days instead of the monthly price — indefinitely, and
 * invisibly, because upsertBrandSubscription updates the single unique row per
 * user rather than appending. The row's EXISTENCE is the durable record that
 * this account has transacted before; its status is not.
 */
export function isEligibleForIntroOffer(priorSubscription: unknown): boolean {
  return priorSubscription === null || priorSubscription === undefined;
}
