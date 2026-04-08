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

  const url = `https://${domain}/wp-json/wc/v3/products?per_page=${limit}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WooCommerce API error (${response.status}): ${text}`);
  }

  return response.json();
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
