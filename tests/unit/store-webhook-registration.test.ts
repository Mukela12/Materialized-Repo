import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerShopifyOrderWebhook } from '../../server/integrations/shopifyService';
import { registerWooOrderWebhook } from '../../server/integrations/woocommerceService';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(status: number, body: any) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('registerShopifyOrderWebhook', () => {
  it('POSTs an orders/create webhook to the Admin API with the access token', async () => {
    const fetchMock = mockFetchOnce(201, { webhook: { id: 42 } });
    const res = await registerShopifyOrderWebhook(
      'https://mystore.myshopify.com/',
      'shpat_token',
      'https://app.example.com/api/webhooks/shopify/conn-1',
    );

    expect(res.id).toBe(42);
    const [url, init] = fetchMock.mock.calls[0];
    // Domain is normalized (scheme + trailing slash stripped).
    expect(url).toBe('https://mystore.myshopify.com/admin/api/2024-01/webhooks.json');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Shopify-Access-Token']).toBe('shpat_token');
    const sent = JSON.parse(init.body);
    expect(sent.webhook.topic).toBe('orders/create');
    expect(sent.webhook.address).toBe('https://app.example.com/api/webhooks/shopify/conn-1');
    expect(sent.webhook.format).toBe('json');
  });

  it('throws on a non-2xx response so the caller can fall back to self-serve', async () => {
    mockFetchOnce(403, { errors: 'not allowed' });
    await expect(
      registerShopifyOrderWebhook('mystore.myshopify.com', 'shpat_token', 'https://app/x'),
    ).rejects.toThrow(/403/);
  });
});

describe('registerWooOrderWebhook', () => {
  it('POSTs an order.created webhook carrying OUR chosen secret', async () => {
    const fetchMock = mockFetchOnce(201, { id: 7 });
    const res = await registerWooOrderWebhook(
      'https://shop.example.com/',
      'ck_key',
      'cs_secret',
      'https://app.example.com/api/webhooks/woocommerce/conn-2',
      'the-shared-secret',
    );

    expect(res.id).toBe(7);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://shop.example.com/wp-json/wc/v3/webhooks');
    expect(init.method).toBe('POST');
    // Basic auth header carries base64(consumerKey:consumerSecret).
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('ck_key:cs_secret').toString('base64')}`,
    );
    const sent = JSON.parse(init.body);
    expect(sent.topic).toBe('order.created');
    expect(sent.delivery_url).toBe('https://app.example.com/api/webhooks/woocommerce/conn-2');
    // The secret we pass is exactly what Woo will sign deliveries with.
    expect(sent.secret).toBe('the-shared-secret');
    expect(sent.status).toBe('active');
  });

  it('throws on a non-2xx response', async () => {
    mockFetchOnce(401, { message: 'bad auth' });
    await expect(
      registerWooOrderWebhook('shop.example.com', 'ck', 'cs', 'https://app/x', 's'),
    ).rejects.toThrow(/401/);
  });
});
