import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchShopifyProducts, parseShopifyNextLink } from '../../server/integrations/shopifyService';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeProducts(n: number, startId = 1) {
  return Array.from({ length: n }, (_, i) => ({ id: startId + i, title: `P${startId + i}` }));
}

function page(products: any[], linkHeader: string | null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ products }),
    text: async () => JSON.stringify({ products }),
    headers: { get: (name: string) => (name.toLowerCase() === 'link' ? linkHeader : null) },
  };
}

describe('parseShopifyNextLink', () => {
  it('extracts the rel="next" URL', () => {
    const header =
      '<https://shop/admin/api/2024-01/products.json?limit=250&page_info=PREV>; rel="previous", ' +
      '<https://shop/admin/api/2024-01/products.json?limit=250&page_info=NEXT>; rel="next"';
    expect(parseShopifyNextLink(header)).toBe(
      'https://shop/admin/api/2024-01/products.json?limit=250&page_info=NEXT',
    );
  });

  it('returns null when there is no next link', () => {
    expect(parseShopifyNextLink('<https://shop/x>; rel="previous"')).toBeNull();
    expect(parseShopifyNextLink(null)).toBeNull();
    expect(parseShopifyNextLink('')).toBeNull();
  });
});

describe('fetchShopifyProducts pagination', () => {
  it('follows the Link header until there is no next page', async () => {
    const nextUrl = 'https://mystore.myshopify.com/admin/api/2024-01/products.json?limit=250&page_info=NEXT';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(makeProducts(250, 1), `<${nextUrl}>; rel="next"`))
      .mockResolvedValueOnce(page(makeProducts(5, 251), null));
    vi.stubGlobal('fetch', fetchMock);

    const all = await fetchShopifyProducts('https://mystore.myshopify.com/', 'shpat_token');

    expect(all).toHaveLength(255);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First call hits the base products URL with limit.
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://mystore.myshopify.com/admin/api/2024-01/products.json?limit=250',
    );
    // Second call fetches the rel="next" cursor URL verbatim.
    expect(fetchMock.mock.calls[1][0]).toBe(nextUrl);
    expect(fetchMock.mock.calls[0][1].headers['X-Shopify-Access-Token']).toBe('shpat_token');
  });

  it('returns a single page when there is no next link', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(makeProducts(3, 1), null));
    vi.stubGlobal('fetch', fetchMock);

    const all = await fetchShopifyProducts('mystore.myshopify.com', 'shpat_token');
    expect(all).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-2xx response, preserving the status', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'unauthorized',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchShopifyProducts('mystore.myshopify.com', 'bad')).rejects.toThrow(/401/);
  });
});
