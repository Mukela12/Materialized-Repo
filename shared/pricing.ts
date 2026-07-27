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
