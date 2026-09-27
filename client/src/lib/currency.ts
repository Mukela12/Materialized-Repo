/**
 * Platform display currency for the UI.
 *
 * The backend bills through Stripe in PLATFORM_CURRENCY (see server/feeConfig.ts
 * `getPlatformCurrency`, default "usd"). The UI must display the same currency so
 * prices shown to users match what they are actually charged. Previously several
 * pages hardcoded the euro symbol while Stripe charged USD — this centralizes it.
 *
 * Override at build time with VITE_PLATFORM_CURRENCY (e.g. "eur"); defaults to USD.
 */
const CODE = (import.meta.env.VITE_PLATFORM_CURRENCY ?? "USD").toUpperCase();

const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  AUD: "A$",
  CAD: "C$",
};

/** ISO code of the platform currency, e.g. "USD". */
export const PLATFORM_CURRENCY_CODE = CODE;

/** Symbol for the platform currency, e.g. "$". */
export const CURRENCY_SYMBOL = SYMBOLS[CODE] ?? "$";

/** Format a platform-currency amount: formatMoney(249) -> "$249.00". */
export function formatMoney(amount: number | string, decimals = 2): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `${CURRENCY_SYMBOL}${(Number.isFinite(n) ? n : 0).toFixed(decimals)}`;
}

/**
 * A headline figure in a given currency: "$1,240", "$18.50", "€300".
 * Whole amounts drop the cents so the number reads at a glance; the currency
 * comes from the data (a brand's orders may not be in the platform currency).
 */
export function formatStatMoney(amount: number, currency: string = CODE): string {
  const code = currency.toUpperCase();
  const whole = Math.round(amount * 100) % 100 === 0;
  const body = amount.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  const symbol = SYMBOLS[code];
  return symbol ? `${symbol}${body}` : `${body} ${code}`;
}
