/**
 * WooCommerce integration for user-driven product imports.
 * Uses REST API with consumer key/secret (no OAuth needed).
 */

interface WooProduct {
  id: number;
  name: string;
  description: string;
  short_description: string;
  sku: string;
  price: string;
  regular_price: string;
  categories: Array<{ id: number; name: string }>;
  images: Array<{ id: number; src: string }>;
  permalink: string;
  type: string;
  status: string;
}

/**
 * Fetch products from a WooCommerce store.
 */
export async function fetchWooCommerceProducts(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string,
  limit = 50
): Promise<WooProduct[]> {
  const cleanUrl = storeUrl.replace(/\/$/, "");
  const url = `${cleanUrl}/wp-json/wc/v3/products?per_page=${limit}`;

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

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

/**
 * Map WooCommerce products to local product schema format.
 */
export function mapWooToLocalProducts(
  wooProducts: WooProduct[],
  brandId: string
): Array<{
  brandId: string;
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  productUrl: string;
  sku: string;
  category: string;
  productType: string;
  isActive: boolean;
}> {
  return wooProducts
    .filter((p) => p.status === "publish")
    .map((product) => ({
      brandId,
      name: product.name,
      description: product.short_description?.replace(/<[^>]*>/g, "").substring(0, 500) || "",
      price: product.price || product.regular_price || "0.00",
      imageUrl: product.images[0]?.src || "",
      productUrl: product.permalink,
      sku: product.sku || "",
      category: product.categories[0]?.name || "General",
      productType: product.type === "virtual" ? "Digital" : "Physical",
      isActive: true,
    }));
}

/**
 * Validate WooCommerce credentials.
 */
export async function validateWooCommerceCredentials(
  storeUrl: string,
  consumerKey: string,
  consumerSecret: string
): Promise<{ valid: boolean; storeName?: string; error?: string }> {
  try {
    const cleanUrl = storeUrl.replace(/\/$/, "");
    const url = `${cleanUrl}/wp-json/wc/v3/system_status`;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!response.ok) {
      return { valid: false, error: `API returned ${response.status}` };
    }

    const data = await response.json();
    return { valid: true, storeName: data.environment?.site_title };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}
