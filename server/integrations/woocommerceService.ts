/**
 * WooCommerce REST API integration for product sync.
 * Uses consumer key/secret for authentication.
 */

interface WooProduct {
  id: number;
  name: string;
  description: string;
  short_description: string;
  sku: string;
  price: string;
  regular_price: string;
  status: string;
  type: string;
  categories: Array<{ id: number; name: string }>;
  images: Array<{ src: string }>;
  permalink: string;
}

export async function fetchWooCommerceProducts(
  storeDomain: string,
  consumerKey: string,
  consumerSecret?: string,
  limit: number = 100
): Promise<WooProduct[]> {
  const domain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const auth = consumerSecret
    ? Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")
    : Buffer.from(`${consumerKey}:`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };

  const products: WooProduct[] = [];
  // Safety ceiling: 500 pages * 100 = 50k products. Guards against a runaway loop
  // if a store ever reports a bogus X-WP-TotalPages count.
  const MAX_PAGES = 500;

  // WooCommerce (wc/v3) paginates with 1-indexed `page` + `per_page` (max 100).
  // The total page count is reported in the X-WP-TotalPages response header on the
  // first request; we loop page=1..N, concatenating each page's array.
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page++) {
    const url = `https://${domain}/wp-json/wc/v3/products?per_page=${limit}&page=${page}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WooCommerce API error (${response.status}): ${text}`);
    }

    if (page === 1) {
      const totalHeader = response.headers.get("x-wp-totalpages");
      const parsed = totalHeader ? parseInt(totalHeader, 10) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) totalPages = parsed;
    }

    const pageProducts = await response.json();
    if (Array.isArray(pageProducts)) {
      // An empty page means we've run past the real data — stop early.
      if (pageProducts.length === 0) break;
      products.push(...pageProducts);
    }
  }

  return products;
}

export async function validateWooCommerceCredentials(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<{ valid: boolean; storeName?: string; error?: string }> {
  try {
    const domain = storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
    const response = await fetch(`https://${domain}/wp-json/wc/v3/system_status`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { valid: true, storeName: data.environment?.site_title || domain };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

/**
 * Register the `order.created` webhook against our receiver so verified sales flow
 * in automatically. WooCommerce is fully zero-touch: WE choose the `secret`, and Woo
 * signs each delivery as base64 HMAC-SHA256 of the raw payload with that exact secret
 * (X-WC-Webhook-Signature) — an exact match for verifyStoreHmac. Throws on any non-2xx
 * so the caller can fall back to self-serve.
 */
export async function registerWooOrderWebhook(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  address: string,
  secret: string,
): Promise<{ id: number }> {
  const domain = storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const response = await fetch(`https://${domain}/wp-json/wc/v3/webhooks`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Materialized orders",
      topic: "order.created",
      delivery_url: address,
      secret,
      status: "active",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WooCommerce webhook registration error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return { id: data.id };
}

export function mapWooToLocalProducts(products: WooProduct[], brandId: string) {
  return products.map(p => mapWooProduct(p, brandId));
}

export function mapWooProduct(product: WooProduct, brandId: string) {
  const image = product.images[0];
  const category = product.categories[0];
  return {
    name: product.name,
    description: product.short_description?.replace(/<[^>]*>/g, "").substring(0, 500) || null,
    price: product.price || product.regular_price || "0.00",
    imageUrl: image?.src || null,
    productUrl: product.permalink || null,
    sku: product.sku || null,
    category: category?.name || null,
    productType: product.type === "virtual" ? "Digital" : "Physical",
    brandId,
  };
}
