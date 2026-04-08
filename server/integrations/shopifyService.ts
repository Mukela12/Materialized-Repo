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

export async function fetchShopifyProducts(
  storeDomain: string,
  accessToken: string,
  limit: number = 250
): Promise<ShopifyProduct[]> {
  const domain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${domain}/admin/api/2024-01/products.json?limit=${limit}`;

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.products;
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

export function mapShopifyToLocalProducts(products: ShopifyProduct[], brandId: string) {
  return products.map(p => mapShopifyProduct(p, brandId));
}

export function mapShopifyProduct(product: ShopifyProduct, brandId: string) {
  const variant = product.variants[0];
  const image = product.images[0];
  return {
    name: product.title,
    description: product.body_html?.replace(/<[^>]*>/g, "").substring(0, 500) || null,
    price: variant?.price || "0.00",
    imageUrl: image?.src || null,
    productUrl: null,
    sku: variant?.sku || null,
    category: product.product_type || null,
    productType: "Physical",
    brandId,
  };
}
