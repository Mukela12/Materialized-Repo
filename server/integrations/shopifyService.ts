/**
 * Shopify integration for user-driven product imports.
 * Each brand connects their OWN Shopify store via access token.
 */

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  handle: string;
  variants: Array<{
    id: number;
    price: string;
    sku: string;
  }>;
  images: Array<{
    id: number;
    src: string;
  }>;
}

interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

/**
 * Fetch products from a Shopify store using the Storefront/Admin API.
 */
export async function fetchShopifyProducts(
  storeDomain: string,
  accessToken: string,
  limit = 50
): Promise<ShopifyProduct[]> {
  const cleanDomain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${cleanDomain}/admin/api/2024-01/products.json?limit=${limit}`;

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

  const data: ShopifyProductsResponse = await response.json();
  return data.products;
}

/**
 * Map Shopify products to local product schema format.
 */
export function mapShopifyToLocalProducts(
  shopifyProducts: ShopifyProduct[],
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
  return shopifyProducts.map((product) => {
    const variant = product.variants[0];
    const image = product.images[0];

    return {
      brandId,
      name: product.title,
      description: product.body_html?.replace(/<[^>]*>/g, "").substring(0, 500) || "",
      price: variant?.price || "0.00",
      imageUrl: image?.src || "",
      productUrl: `https://${product.handle}`,
      sku: variant?.sku || "",
      category: product.product_type || "General",
      productType: "Physical",
      isActive: true,
    };
  });
}

/**
 * Validate Shopify credentials by making a test API call.
 */
export async function validateShopifyCredentials(
  storeDomain: string,
  accessToken: string
): Promise<{ valid: boolean; shopName?: string; error?: string }> {
  try {
    const cleanDomain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const url = `https://${cleanDomain}/admin/api/2024-01/shop.json`;

    const response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return { valid: false, error: `API returned ${response.status}` };
    }

    const data = await response.json();
    return { valid: true, shopName: data.shop?.name };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}
