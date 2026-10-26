/**
 * In-video checkout charges in US dollars (client, 25 Oct 2026): a shopper
 * buying a €49 piece pays the dollar amount at that day's rate, and sees both,
 * "$54.85 (€49.00)". The brand still sets prices in its own currency.
 *
 * Rates are the European Central Bank's daily reference rates via Frankfurter
 * (no key, one request per currency per few hours). If the rate can't be had,
 * the sale is charged in the product's own currency as before, so a rate
 * service being down never stops anyone buying.
 */

export const CHARGE_CURRENCY = "usd";
const FRESH_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { rate: number; at: number; date: string | null }>();

/** US dollars per one unit of `currency`, or null when it can't be had. */
export async function usdRate(currency: string, fetcher: typeof fetch = fetch): Promise<{ rate: number; date: string | null } | null> {
  const cur = currency.trim().toUpperCase();
  if (cur === "USD") return { rate: 1, date: null };
  if (!/^[A-Z]{3}$/.test(cur)) return null;
  const hit = cache.get(cur);
  if (hit && Date.now() - hit.at < FRESH_MS) return { rate: hit.rate, date: hit.date };
  try {
    const res = await fetcher(`https://api.frankfurter.dev/v1/latest?base=${cur}&symbols=USD`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return hit ? { rate: hit.rate, date: hit.date } : null;
    const body = await res.json() as { rates?: { USD?: number }; date?: string };
    const rate = Number(body?.rates?.USD);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 10_000) return hit ? { rate: hit.rate, date: hit.date } : null;
    cache.set(cur, { rate, at: Date.now(), date: body.date ?? null });
    return { rate, date: body.date ?? null };
  } catch {
    // A stale rate beats none; none means "charge in the product's currency".
    return hit ? { rate: hit.rate, date: hit.date } : null;
  }
}

export interface ChargeAmount {
  amountCents: number;
  currency: string;
  /** What the brand priced it at, when that differs from what is charged. */
  original: { amountCents: number; currency: string; rate: number; date: string | null } | null;
}

/** The amount to charge: converted to dollars when a rate is known, else as priced. */
export function toChargeAmount(priceCents: number, currency: string, fx: { rate: number; date: string | null } | null): ChargeAmount {
  const cur = currency.toLowerCase();
  if (cur === CHARGE_CURRENCY || !fx) return { amountCents: priceCents, currency: cur, original: null };
  return {
    amountCents: Math.round(priceCents * fx.rate),
    currency: CHARGE_CURRENCY,
    original: { amountCents: priceCents, currency: cur, rate: fx.rate, date: fx.date },
  };
}

const SYMBOL: Record<string, string> = { usd: "$", eur: "€", gbp: "£", jpy: "¥" };

/** "$54.85" or "CHF 49.00". */
export function money(cents: number, currency: string): string {
  const cur = currency.toLowerCase();
  const n = (cents / 100).toFixed(2);
  return SYMBOL[cur] ? `${SYMBOL[cur]}${n}` : `${cur.toUpperCase()} ${n}`;
}

/** "$54.85 (€49.00)" for the checkout, or just the price when nothing was converted. */
export function chargeLabel(c: ChargeAmount): string {
  return c.original ? `${money(c.amountCents, c.currency)} (${money(c.original.amountCents, c.original.currency)})` : money(c.amountCents, c.currency);
}

/** For tests. */
export function clearFxCache() { cache.clear(); }
