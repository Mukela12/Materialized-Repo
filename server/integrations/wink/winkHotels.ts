/**
 * WINK hotels for the video carousel: the parts with no network in them.
 *
 * MTRLZD is a WINK affiliate (26 Nov 2026). A creator puts a WINK hotel on a
 * travel video, the carousel shows it with a BOOK NOW button, and the viewer
 * books on WINK's own booking page. WINK credits the booking to MTRLZD through
 * our customization id (`cid`) on that page's address and pays the commission
 * after check-in. Nothing is charged on MTRLZD, so a hotel card never has a
 * chargeable price: what it shows is WINK's lowest base rate as a label.
 *
 * Kept free of I/O so it can be tested without WINK: winkClient.ts does the
 * calls and uses these to shape what comes back.
 */

export type WinkEnv = "staging" | "production";

export interface WinkConfig {
  env: WinkEnv;
  tokenUrl: string;
  partnerHost: string;
  bookHost: string;
  clientId: string;
  clientSecret: string;
  accountId: string;
  customizationId: string;
}

const HOSTS: Record<WinkEnv, { tokenUrl: string; partnerHost: string; bookHost: string }> = {
  staging: {
    tokenUrl: "https://staging-iam.wink.travel/oauth2/token",
    partnerHost: "staging-partner.wink.travel:443",
    bookHost: "https://staging-book.wink.travel",
  },
  production: {
    tokenUrl: "https://iam.wink.travel/oauth2/token",
    partnerHost: "partner.wink.travel:443",
    bookHost: "https://book.wink.travel",
  },
};

/**
 * Null until all four WINK values are set, which is how the feature stays off
 * on a server that has not been given them. Staging unless WINK_ENV says
 * production, because staging and production keys and ids are separate and a
 * staging id on the live booking page would credit nobody.
 */
export function winkConfig(env: NodeJS.ProcessEnv = process.env): WinkConfig | null {
  const clientId = env.WINK_CLIENT_ID?.trim();
  const clientSecret = env.WINK_CLIENT_SECRET?.trim();
  const accountId = env.WINK_ACCOUNT_ID?.trim();
  const customizationId = env.WINK_CUSTOMIZATION_ID?.trim();
  if (!clientId || !clientSecret || !accountId || !customizationId) return null;
  const which: WinkEnv = env.WINK_ENV?.trim() === "production" ? "production" : "staging";
  return { env: which, ...HOSTS[which], clientId, clientSecret, accountId, customizationId };
}

/** WINK's hotel and city slugs, e.g. traveligo-hotel-bangkok-thailand. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isWinkSlug(v: unknown): v is string {
  return typeof v === "string" && v.length >= 2 && v.length <= 160 && SLUG.test(v);
}

/**
 * The hotel's page on WINK's booking site, credited to MTRLZD.
 * `cid` is the customization id: without it WINK books the stay and credits no
 * one. Dates and guests are left to the viewer.
 */
export function winkBookingUrl(cfg: Pick<WinkConfig, "bookHost" | "customizationId">, urlName: string): string {
  if (!isWinkSlug(urlName)) throw new Error("Not a WINK hotel slug");
  const q = new URLSearchParams({ cid: cfg.customizationId, c: "USD", l: "en", src: "LINK" });
  return `${cfg.bookHost}/hotel/${urlName}?${q.toString()}`;
}

/** What the creator picks from, and what a carousel card is made from. */
export interface WinkHotel {
  urlName: string;
  name: string;
  city: string | null;
  country: string | null;
  imageUrl: string | null;
  stars: number | null;
  /** WINK's lowest base rate as a label, e.g. "from $120". Never charged. */
  fromPrice: string | null;
  /** The commission the hotel offers WINK affiliates, as a percentage. */
  commissionPct: number | null;
}

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/**
 * "from $120" from WINK's minor units. WINK sends whole minor units plus the
 * currency's exponent, so 12000 with exponent 2 is 120.00. Rounded up to a
 * whole unit: it is a teaser on a small card, and rounding down would quote
 * less than the cheapest room.
 */
export function formatFromPrice(minor: unknown, currencyCode: unknown, exponent: unknown): string | null {
  const amount = typeof minor === "string" ? Number(minor) : minor;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  const code = typeof currencyCode === "string" && /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : null;
  if (!code) return null;
  const exp = typeof exponent === "number" && exponent >= 0 && exponent <= 4 ? exponent : 2;
  const whole = Math.ceil(amount / 10 ** exp);
  const n = whole.toLocaleString("en-US");
  return SYMBOLS[code] ? `from ${SYMBOLS[code]}${n}` : `from ${n} ${code}`;
}

/** Only https pictures go into a page served on a brand's site. */
function httpsOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[<>"'&]/g, "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/**
 * WINK image addresses leave the width open as a literal `{size}`, to be
 * replaced with 160, 320, 640, 1024 or 1920. 640 is sharp on a carousel card
 * at 2x without shipping a full-size photo into every embed.
 */
export function winkImageUrl(template: unknown, width: 160 | 320 | 640 | 1024 | 1920 = 640): string | null {
  if (typeof template !== "string") return null;
  return httpsOrNull(template.split("{size}").join(String(width)));
}

/**
 * The "from" label in US dollars when WINK sends a USD quote, otherwise in the
 * hotel's own currency. Rates come in the hotel's currency; with
 * quote_currencies = USD, WINK adds the rate to convert them, as a decimal
 * string (USD per one unit of the hotel's currency).
 */
export function fromPriceLabel(asLowAs: unknown, currency: any): string | null {
  const exp = Number(currency?.currencyExponent);
  const usd = Array.isArray(currency?.fxQuotes)
    ? currency.fxQuotes.find((q: any) => q?.currencyCode === "USD")
    : null;
  const rate = usd ? Number(usd.rate) : NaN;
  const minor = typeof asLowAs === "string" ? Number(asLowAs) : asLowAs;
  if (currency?.currencyCode !== "USD" && Number.isFinite(rate) && rate > 0 && typeof minor === "number") {
    const units = minor / 10 ** (Number.isFinite(exp) ? exp : 2);
    return formatFromPrice(Math.ceil(units * rate * 100), "USD", 2);
  }
  return formatFromPrice(asLowAs, currency?.currencyCode, Number.isFinite(exp) ? exp : 2);
}

/** One hotel from SearchByCity (field names as the proto loader gives them). */
export function hotelFromSearchResult(r: any): WinkHotel | null {
  if (!r || !isWinkSlug(r.urlName)) return null;
  const name = text(r.name, 120);
  if (!name) return null;
  const stars = Number(r.starRating);
  // WINK sends commission as a fraction: 0.15 is 15%.
  const commission = Number(r.commission);
  return {
    urlName: r.urlName,
    name,
    city: text(r.city?.name, 80),
    country: null,
    imageUrl: winkImageUrl(r.heroImageUrl),
    stars: Number.isInteger(stars) && stars > 0 && stars <= 5 ? stars : null,
    fromPrice: fromPriceLabel(r.asLowAs, r.currency),
    commissionPct:
      Number.isFinite(commission) && commission > 0 && commission <= 1 ? Math.round(commission * 1000) / 10 : null,
  };
}

/** One hotel from Lookup (a destination of type PROPERTY). No picture or rate. */
export function hotelFromDestination(d: any): WinkHotel | null {
  if (!d || d.type !== "DESTINATION_TYPE_PROPERTY" || !isWinkSlug(d.urlName)) return null;
  const name = text(d.name, 120);
  if (!name) return null;
  return {
    urlName: d.urlName,
    name,
    city: text(d.cityName, 80),
    country: text(d.countryName, 80),
    imageUrl: null,
    stars: null,
    fromPrice: null,
    commissionPct: null,
  };
}

/** A city to run a hotel search in, from a Lookup destination. */
export function cityFromDestination(d: any): { urlName: string; name: string; country: string | null } | null {
  if (!d || d.type !== "DESTINATION_TYPE_CITY" || !isWinkSlug(d.urlName)) return null;
  const name = text(d.name, 80);
  return name ? { urlName: d.urlName, name, country: text(d.countryName, 80) } : null;
}

/**
 * The carousel card for a hotel. The button opens MTRLZD's own redirect
 * (/api/wink/book/<slug>), not WINK directly, so the credited id lives in one
 * place on the server and moving from staging to production changes every
 * card already published without touching a row.
 */
export function hotelOverlayFields(hotel: WinkHotel, origin: string) {
  return {
    name: hotel.name,
    productUrl: `${origin.replace(/\/$/, "")}/api/wink/book/${hotel.urlName}`,
    imageUrl: hotel.imageUrl,
    price: hotel.fromPrice,
    // Explicitly not chargeable: the stay is paid on WINK, never on MTRLZD.
    priceCents: null,
    brandName: hotel.city ?? hotel.country ?? "Hotel",
    buttonLabel: "BOOK NOW",
    source: "wink" as const,
  };
}
