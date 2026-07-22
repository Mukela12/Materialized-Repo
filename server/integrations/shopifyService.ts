/**
 * Shopify Admin API integration for product sync.
 * Each brand connects their own Shopify store via access token.
 */

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  handle: string;
  status: string;
  images: Array<{ src: string }>;
  variants: Array<{ id: number; price: string; sku: string }>;
}

/**
 * Extract the `rel="next"` URL from a Shopify `Link` response header, if present.
 * Shopify's 2024-01 REST Admin API uses cursor-based pagination: each response
 * carries a `Link` header whose `rel="next"` segment is the fully-formed URL
 * (already including `limit` and the opaque `page_info` cursor) for the next page.
 * That URL must be fetched verbatim — appending other query params to a
 * `page_info` request is rejected by Shopify. Returns null on the last page.
 */
export function parseShopifyNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (match) return match[1].trim();
  }
  return null;
}

export async function fetchShopifyProducts(
  storeDomain: string,
  accessToken: string,
  limit: number = 250
): Promise<ShopifyProduct[]> {
  const domain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const headers = {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  };

  // First page: the store domain + limit. Subsequent pages come verbatim from the
  // `rel="next"` Link header, so we must NOT re-append params to those cursor URLs.
  let currentUrl: string | null = `https://${domain}/admin/api/2024-01/products.json?limit=${limit}`;

  const products: ShopifyProduct[] = [];
  // Safety ceiling: 200 pages * 250 = 50k products. Prevents an infinite loop if a
  // malformed Link header ever cycles back on itself.
  const MAX_PAGES = 200;

  for (let page = 0; page < MAX_PAGES && currentUrl; page++) {
    const response: Response = await fetch(currentUrl, { headers });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    if (Array.isArray(data.products)) {
      products.push(...data.products);
    }

    currentUrl = parseShopifyNextLink(response.headers.get("link"));
  }

  return products;
}

export async function validateShopifyCredentials(
  storeDomain: string,
  accessToken: string
): Promise<{ valid: boolean; shopName?: string; error?: string }> {
  try {
    const domain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const response = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });
    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { valid: true, shopName: data.shop?.name || domain };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

/**
 * Register the `orders/create` webhook against our receiver so verified sales flow
 * in automatically. Shopify signs these deliveries with the app's API secret key
 * (NOT a per-webhook secret we can set here), which is why the connect handler also
 * persists a webhookSecret the brand supplies for verification. Returns the created
 * webhook id; throws on any non-2xx so the caller can fall back to self-serve.
 */
export async function registerShopifyOrderWebhook(
  storeDomain: string,
  accessToken: string,
  address: string,
): Promise<{ id: number }> {
  const domain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${domain}/admin/api/2024-01/webhooks.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      webhook: { topic: "orders/create", address, format: "json" },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify webhook registration error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return { id: data.webhook?.id };
}

/**
 * Register the `orders/refunded` webhook against our refund receiver so refunds flow in
 * automatically and claw back the commission. Signed with the same app secret as
 * orders/create, so verifyStoreHmac works unchanged. Its payload is a full order object,
 * so `order.id` equals the id we stored on the sale. Throws on any non-2xx.
 */
export async function registerShopifyRefundWebhook(
  storeDomain: string,
  accessToken: string,
  address: string,
): Promise<{ id: number }> {
  const domain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${domain}/admin/api/2024-01/webhooks.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      webhook: { topic: "orders/refunded", address, format: "json" },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify refund webhook registration error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return { id: data.webhook?.id };
}

export function mapShopifyToLocalProducts(products: ShopifyProduct[], brandId: string, storeDomain?: string) {
  return products.map(p => mapShopifyProduct(p, brandId, storeDomain));
}

export function mapShopifyProduct(product: ShopifyProduct, brandId: string, storeDomain?: string) {
  const variant = product.variants[0];
  const image = product.images[0];
  const cleanDomain = storeDomain?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const productUrl = cleanDomain && product.handle
    ? `https://${cleanDomain}/products/${product.handle}`
    : null;
  return {
    name: product.title,
    description: product.body_html?.replace(/<[^>]*>/g, "").substring(0, 500) || null,
    price: variant?.price || "0.00",
    imageUrl: image?.src || null,
    productUrl,
    sku: variant?.sku || null,
    category: product.product_type || null,
    productType: "Physical",
    brandId,
  };
}
