/**
 * Marketplace fee & commission split.
 *
 * On a gross brand sale the platform takes a "marketplace fee" (default 15%);
 * the brand keeps the remainder (85%). Out of the marketplace fee the publisher
 * earns a commission when the sale is attributed to their repost (default 2%).
 * Whatever is left of the fee is the platform's margin (~13%).
 *
 *   gross sale 100%
 *     ├─ brand            85%   (kept by the brand)
 *     └─ marketplace fee  15%
 *          ├─ creator      0%   (see below)
 *          ├─ publisher    2%   (0% when no publisher is attributed)
 *          └─ platform   ~13%   (remainder of the fee)
 *
 * CREATOR RATE IS 0 BY DESIGN (client decision, 27 Jul 2026). Creators are paid
 * by brands directly, outside MTRLZD, so the platform does not accrue a creator
 * commission by default. The rationale: industry creator rates are 8-12%, which
 * on top of the publisher's 2% would leave no margin inside a 15% fee.
 *
 * It remains fully supported, not removed — set CREATOR_COMMISSION_PCT, the
 * platform_settings row, or a per-user commissionRateOverride to switch it on for
 * a specific arrangement. A 0 rate simply means no creator commission row is
 * written (recordSaleCommissions skips zero-value rows), so creators see no
 * in-app earnings unless a rate is set for them.
 *
 * Historical rows are unaffected: the split is computed and stored per sale, so
 * changing this default never rewrites past commissions.
 *
 * All money is handled in integer cents to avoid floating-point drift, and
 * converted to fixed(2) decimal strings only at the storage boundary
 * (commission_transactions columns are decimal(10,2)).
 *
 * Defaults are admin-adjustable. For now they are read from env with the agreed
 * defaults as fallback; a DB-backed, per-user override is the next increment.
 */

export interface FeeConfig {
  /** Platform's total take of a gross sale, in percent. Default 15. */
  marketplaceFeePct: number;
  /** Creator's share of a gross sale, in percent. Default 0 — see the file header. */
  creatorPct: number;
  /** Publisher's share of a gross sale, in percent (when attributed). Default 2. */
  publisherPct: number;
}

function pctFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Current platform default rates (env-overridable). */
export function getFeeConfig(): FeeConfig {
  return {
    marketplaceFeePct: pctFromEnv("MARKETPLACE_FEE_PCT", 15),
    creatorPct: pctFromEnv("CREATOR_COMMISSION_PCT", 0),
    publisherPct: pctFromEnv("PUBLISHER_COMMISSION_PCT", 2),
  };
}

/**
 * ISO currency code used for all Stripe charges, subscriptions, and payouts.
 * Must match the platform Stripe account's currency (e.g. a US account settles in
 * USD, so transferring EUR fails with "insufficient funds"). Defaults to USD;
 * set PLATFORM_CURRENCY=eur for a EUR account.
 */
/**
 * Collect the marketplace fee by charging the card the brand already has on
 * file, rather than emailing them an invoice to pay.
 *
 * Default TRUE. Emailing thousands of brands an invoice each month and chasing
 * the unpaid ones is not a process that scales, and these brands are already
 * paying a subscription on the same card. Set FEE_INVOICE_COLLECTION=send_invoice
 * to switch a deployment back to emailed invoices.
 *
 * This does NOT make the fee a Stripe application fee. The money is collected
 * from the brand after the sale, not withheld from the shopper's payment as it
 * passes through — that requires the checkout itself to run through MTRLZD.
 * Keep the two straight when describing this to a brand.
 */
export function feeInvoiceAutoCharge(): boolean {
  return (process.env.FEE_INVOICE_COLLECTION || "auto_charge").toLowerCase() !== "send_invoice";
}

export function getPlatformCurrency(): string {
  return (process.env.PLATFORM_CURRENCY || "usd").toLowerCase();
}

/**
 * Format a decimal-string (or number) amount for human display using the
 * configured platform currency, e.g. "12.50" → "$12.50" (usd) / "€12.50" (eur).
 * Falls back to "<CODE> 12.50" for currencies Intl can't symbolise.
 */
export function formatMoney(amount: string | number, currency: string = getPlatformCurrency()): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  const value = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(value);
  } catch {
    return `${currency.toUpperCase()} ${value.toFixed(2)}`;
  }
}

/** Admin-editable platform settings row (all optional; null → fall back to defaults). */
export interface PlatformFeeSettings {
  marketplaceFeePct?: number | string | null;
  creatorPct?: number | string | null;
  publisherPct?: number | string | null;
}

/** Coerce a value to a non-negative number, else return the fallback. */
export function numOr(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseFloat(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Effective platform rates: admin-set DB values layered over the env defaults.
 * A null/blank setting falls back to the default, so partial config is safe.
 */
export function resolveFeeConfig(settings?: PlatformFeeSettings | null): FeeConfig {
  const env = getFeeConfig();
  return {
    marketplaceFeePct: numOr(settings?.marketplaceFeePct, env.marketplaceFeePct),
    creatorPct: numOr(settings?.creatorPct, env.creatorPct),
    publisherPct: numOr(settings?.publisherPct, env.publisherPct),
  };
}

/** A user's per-account rate override (users.commissionRateOverride) or the default. */
export function userRateOr(override: string | number | null | undefined, fallback: number): number {
  return numOr(override, fallback);
}

/** Round a decimal money value (string or number) to integer cents. */
export function toCents(amount: string | number): number {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Integer cents → fixed(2) decimal string for decimal(10,2) storage. */
export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** `cents * pct / 100`, rounded to the nearest cent (half-up). */
function pctCents(cents: number, pct: number): number {
  return Math.round((cents * pct) / 100);
}

export interface SplitRates {
  marketplaceFeePct?: number;
  creatorPct?: number;
  publisherPct?: number;
}

export interface SaleSplit {
  saleCents: number;
  /** Brand's share (gross − marketplace fee). */
  brandCents: number;
  /** Platform's gross take. */
  marketplaceFeeCents: number;
  /** Creator commission (carved out of the fee). */
  creatorCents: number;
  /** Publisher commission (0 when no publisher attributed). */
  publisherCents: number;
  /** Remainder of the fee kept by the platform. */
  platformCents: number;
  /** The rates actually applied, after clamping. */
  effectiveRates: { marketplaceFeePct: number; creatorPct: number; publisherPct: number };
}

/**
 * Compute the full split for a sale.
 *
 * Conservation is exact:
 *   brandCents + marketplaceFeeCents === saleCents
 *   creatorCents + publisherCents + platformCents === marketplaceFeeCents
 *
 * Affiliate commissions are capped at the marketplace fee (publisher is reduced
 * first, then creator) so the platform margin can never go negative — the fee is
 * the ceiling for everything paid out of it.
 */
export function computeSaleSplit(
  saleCents: number,
  opts: { hasPublisher: boolean } & SplitRates,
): SaleSplit {
  const cfg = getFeeConfig();
  const marketplaceFeePct = Math.max(0, opts.marketplaceFeePct ?? cfg.marketplaceFeePct);
  let creatorPct = Math.max(0, opts.creatorPct ?? cfg.creatorPct);
  let publisherPct = opts.hasPublisher ? Math.max(0, opts.publisherPct ?? cfg.publisherPct) : 0;

  // Cap payouts at the marketplace fee: reduce publisher first, then creator.
  if (publisherPct > marketplaceFeePct) publisherPct = marketplaceFeePct;
  if (creatorPct + publisherPct > marketplaceFeePct) {
    creatorPct = Math.max(0, marketplaceFeePct - publisherPct);
  }

  const sale = Math.max(0, Math.round(saleCents));
  const marketplaceFeeCents = pctCents(sale, marketplaceFeePct);
  const brandCents = sale - marketplaceFeeCents; // absorbs fee rounding
  const creatorCents = pctCents(sale, creatorPct);
  const publisherCents = pctCents(sale, publisherPct);
  const platformCents = marketplaceFeeCents - creatorCents - publisherCents; // absorbs remainder

  return {
    saleCents: sale,
    brandCents,
    marketplaceFeeCents,
    creatorCents,
    publisherCents,
    platformCents,
    effectiveRates: { marketplaceFeePct, creatorPct, publisherPct },
  };
}

/** Non-null warning string when the default config would over-allocate the fee. */
export function feeConfigWarning(cfg: FeeConfig = getFeeConfig()): string | null {
  if (cfg.creatorPct + cfg.publisherPct > cfg.marketplaceFeePct) {
    return `Commission split misconfigured: creator (${cfg.creatorPct}%) + publisher (${cfg.publisherPct}%) ` +
      `exceeds marketplace fee (${cfg.marketplaceFeePct}%); payouts will be capped at the fee.`;
  }
  return null;
}
