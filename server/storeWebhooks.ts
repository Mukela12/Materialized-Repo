/**
 * Signed store order webhooks — the automated verified-sales path.
 *
 * Shopify and WooCommerce both sign the webhook with base64 HMAC-SHA256 over the
 * RAW request body. We verify that signature (so a sale can't be forged), then
 * pull the attribution ref that was carried to the store on the embed click
 * (see server/embedUtils.ts — utm_campaign / mtrlzd_ref) plus the order total.
 *
 * All functions here are pure so they can be unit-tested without a live store.
 */
import { createHmac, timingSafeEqual } from "crypto";

/** HMAC-SHA256 of the raw body, base64 — the scheme both Shopify and Woo use. */
export function computeHmac(rawBody: Buffer | string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

/** Constant-time compare of two base64 strings. */
function safeEqualB64(a: string, b: string): boolean {
  const ba = Buffer.from(a, "base64");
  const bb = Buffer.from(b, "base64");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Verify a store webhook signature against the raw body. */
export function verifyStoreHmac(
  rawBody: Buffer | string | undefined,
  providedHmac: string | undefined,
  secret: string | undefined,
): boolean {
  if (!rawBody || !providedHmac || !secret) return false;
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return safeEqualB64(computeHmac(body, secret), providedHmac);
}

export interface OrderAttribution {
  /** The store's order id — used for idempotency + reconciliation. */
  externalOrderId: string | null;
  /** The mtrlzd_ref / utm_campaign carried from the embed click (resolves to an affiliate). */
  ref: string | null;
  /** Gross order total as a decimal string. */
  amount: string;
}

const REF_KEYS = ["mtrlzd_ref", "utm_campaign"];

/** Pull the first attribution ref found in a URL's query string. */
function refFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "https://placeholder.local");
    for (const k of REF_KEYS) {
      const v = u.searchParams.get(k);
      if (v) return v;
    }
  } catch {
    /* not a parseable URL */
  }
  return null;
}

export function extractShopifyAttribution(order: any): OrderAttribution {
  const externalOrderId = order?.id != null ? String(order.id) : null;
  const amount = String(order?.total_price ?? order?.current_total_price ?? order?.subtotal_price ?? "0.00");

  let ref: string | null = null;
  const attrs = Array.isArray(order?.note_attributes) ? order.note_attributes : [];
  for (const a of attrs) {
    if (a && REF_KEYS.includes(String(a.name)) && a.value) {
      ref = String(a.value);
      break;
    }
  }
  if (!ref) ref = refFromUrl(order?.landing_site) ?? refFromUrl(order?.referring_site);

  return { externalOrderId, ref, amount };
}

export function extractWooAttribution(order: any): OrderAttribution {
  const externalOrderId = order?.id != null ? String(order.id) : null;
  const amount = String(order?.total ?? "0.00");

  let ref: string | null = null;
  const meta = Array.isArray(order?.meta_data) ? order.meta_data : [];
  for (const m of meta) {
    if (m && REF_KEYS.includes(String(m.key)) && m.value) {
      ref = String(m.value);
      break;
    }
  }

  return { externalOrderId, ref, amount };
}
