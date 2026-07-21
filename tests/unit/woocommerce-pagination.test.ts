import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWooCommerceProducts } from '../../server/integrations/woocommerceService';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeProducts(n: number, startId = 1) {
  return Array.from({ length: n }, (_, i) => ({ id: startId + i, name: `P${startId + i}` }));
}

function page(products: any[], totalPages?: number) {
  return {
    ok: true,
    status: 200,
    json: async () => products,
    text: async () => JSON.stringify(products),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-wp-totalpages' && totalPages != null ? String(totalPages) : null,
    },
  };
}

describe('fetchWooCommerceProducts pagination', () => {
  it('loops page=1..N using X-WP-TotalPages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(makeProducts(100, 1), 2))
      .mockResolvedValueOnce(page(makeProducts(3, 101)));
    vi.stubGlobal('fetch', fetchMock);

    const all = await fetchWooCommerceProducts('https://shop.example.com/', 'ck_key', 'cs_secret');

    expect(all).toHaveLength(103);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://shop.example.com/wp-json/wc/v3/products?per_page=100&page=1',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://shop.example.com/wp-json/wc/v3/products?per_page=100&page=2',
    );
    // Basic auth carries base64(consumerKey:consumerSecret).
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      `Basic ${Buffer.from('ck_key:cs_secret').toString('base64')}`,
    );
  });

  it('fetches a single page when the header reports one total page', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(makeProducts(5, 1), 1));
    vi.stubGlobal('fetch', fetchMock);

    const all = await fetchWooCommerceProducts('shop.example.com', 'ck_key', 'cs_secret');
    expect(all).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('defaults to a single page when the total-pages header is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(makeProducts(4, 1)));
    vi.stubGlobal('fetch', fetchMock);

    const all = await fetchWooCommerceProducts('shop.example.com', 'ck_key', 'cs_secret');
    expect(all).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops early when a page returns an empty array', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(makeProducts(100, 1), 3))
      .mockResolvedValueOnce(page([], 3));
    vi.stubGlobal('fetch', fetchMock);

    const all = await fetchWooCommerceProducts('shop.example.com', 'ck_key', 'cs_secret');
    expect(all).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on a non-2xx response, preserving the status', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => 'forbidden',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWooCommerceProducts('shop.example.com', 'ck_key', 'cs_secret'),
    ).rejects.toThrow(/403/);
  });
});
