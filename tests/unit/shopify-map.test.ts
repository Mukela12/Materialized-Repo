import { describe, it, expect } from 'vitest';
import { mapShopifyProduct } from '../../server/integrations/shopifyService';

const product: any = {
  id: 1,
  title: 'Linen Shirt',
  body_html: '<p>Soft <b>linen</b></p>',
  vendor: 'Acme',
  product_type: 'Shirts',
  handle: 'linen-shirt',
  status: 'active',
  images: [{ src: 'https://cdn.shop/x.jpg' }],
  variants: [{ id: 9, price: '49.00', sku: 'LS-01' }],
};

describe('mapShopifyProduct', () => {
  it('builds the product URL from the store domain and handle', () => {
    const p = mapShopifyProduct(product, 'brand1', 'acme.myshopify.com');
    expect(p.productUrl).toBe('https://acme.myshopify.com/products/linen-shirt');
  });

  it('strips protocol/trailing slash from the store domain', () => {
    const p = mapShopifyProduct(product, 'brand1', 'https://acme.myshopify.com/');
    expect(p.productUrl).toBe('https://acme.myshopify.com/products/linen-shirt');
  });

  it('leaves productUrl null when no store domain is provided', () => {
    const p = mapShopifyProduct(product, 'brand1');
    expect(p.productUrl).toBeNull();
  });

  it('maps the core fields and strips HTML from the description', () => {
    const p = mapShopifyProduct(product, 'brand1', 'acme.myshopify.com');
    expect(p.name).toBe('Linen Shirt');
    expect(p.price).toBe('49.00');
    expect(p.sku).toBe('LS-01');
    expect(p.imageUrl).toBe('https://cdn.shop/x.jpg');
    expect(p.description).toBe('Soft linen');
    expect(p.brandId).toBe('brand1');
  });
});
