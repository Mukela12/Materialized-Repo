/**
 * Single source of truth for one-off (non-subscription) marketplace prices.
 *
 * Amounts are MAJOR UNITS in the platform currency (see `getPlatformCurrency()`
 * in server/feeConfig.ts, default "usd"). `stripeService.createPaymentIntent()`
 * takes major units and multiplies by 100 internally — never pass cents.
 *
 * Client-facing copy should import LICENSE_FEE rather than inlining the number,
 * and render it next to CURRENCY_SYMBOL (client/src/lib/currency.ts) rather than
 * a hardcoded currency symbol.
 */

/** Fee to import one video into the Global Video Library. */
export const LICENSE_FEE = 49;

/** Same value as a fixed(2) decimal string, for decimal(10,2) columns. */
export const LICENSE_FEE_DECIMAL = LICENSE_FEE.toFixed(2);

/**
 * Playlist curation is charged PER VIDEO at the same licence fee — a 5-video
 * playlist costs 5 × LICENSE_FEE.
 */
export const LICENSE_FEE_PER_VIDEO = LICENSE_FEE;

// ─── Wallet tokens ───────────────────────────────────────────────────────────
//
// Client spec (27 Jul 2026): "1 Token = $49". A token is a PREPAID PLATFORM
// CREDIT, not cash — see the module doc on server/wallet.ts for the full
// non-cashability statement.

/** Current grant-time value of one token, in MAJOR units. */
export const TOKEN_USD = 49;

/**
 * Current grant-time value of one token, in integer CENTS.
 *
 * THIS IS THE PRICE FOR *NEW* ROWS ONLY. Every token_ledger row stores its own
 * `usd_value_cents` at the moment it was written (invariant 5), so changing this
 * constant reprices future grants and spends and never rewrites history. Read a
 * historical row's value from the row, never from this constant.
 */
export const TOKEN_USD_CENTS = TOKEN_USD * 100; // 4900

/**
 * TOKEN_USD and LICENSE_FEE are both 49 today by COINCIDENCE, not by definition:
 * one is what a token is worth, the other is what a listing costs. They are
 * deliberately two constants. `tokensForFee()` is the only place the two are
 * allowed to meet, and it refuses to quote a price that a whole number of tokens
 * cannot cover exactly — silently over- or under-charging is the failure mode.
 *
 * Returns null when `feeMajorUnits` is not an exact multiple of TOKEN_USD, which
 * callers must surface as "this cannot be paid with tokens" rather than rounding.
 */
export function tokensForFee(feeMajorUnits: number): number | null {
  const feeCents = Math.round(feeMajorUnits * 100);
  if (feeCents <= 0) return null;
  if (feeCents % TOKEN_USD_CENTS !== 0) return null;
  return feeCents / TOKEN_USD_CENTS;
}
