import { describe, it, expect } from 'vitest';
import { appendUtm } from '../../server/embedUtils';

describe('appendUtm', () => {
  it('returns null when there is no url', () => {
    expect(appendUtm(null, 'CODE')).toBeNull();
    expect(appendUtm(undefined, 'CODE')).toBeNull();
    expect(appendUtm('', 'CODE')).toBeNull();
  });

  it('returns the url unchanged when there is no utm code', () => {
    expect(appendUtm('https://shop.com/p/1', '')).toBe('https://shop.com/p/1');
  });

  it('adds attribution params to a bare URL', () => {
    const out = appendUtm('https://shop.com/products/hat', 'UTM_ABC');
    const u = new URL(out!);
    expect(u.searchParams.get('utm_source')).toBe('materialized');
    expect(u.searchParams.get('utm_medium')).toBe('shoppable_video');
    expect(u.searchParams.get('utm_campaign')).toBe('UTM_ABC');
    expect(u.searchParams.get('mtrlzd_ref')).toBe('UTM_ABC');
  });

  it('preserves an existing query string', () => {
    const out = appendUtm('https://shop.com/p?color=red', 'X1');
    const u = new URL(out!);
    expect(u.searchParams.get('color')).toBe('red');
    expect(u.searchParams.get('mtrlzd_ref')).toBe('X1');
  });

  it('keeps the fragment after the query', () => {
    const out = appendUtm('https://shop.com/p#reviews', 'X1');
    expect(out).toContain('mtrlzd_ref=X1');
    expect(out!.endsWith('#reviews')).toBe(true);
  });

  it('falls back gracefully for a relative URL', () => {
    const out = appendUtm('/products/hat', 'X1');
    expect(out).toBe('/products/hat?utm_source=materialized&utm_medium=shoppable_video&utm_campaign=X1&mtrlzd_ref=X1');
  });

  it('appends with & when a relative URL already has a query', () => {
    const out = appendUtm('/products/hat?v=2', 'X1');
    expect(out!.startsWith('/products/hat?v=2&utm_source=materialized')).toBe(true);
  });
});
