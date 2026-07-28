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
